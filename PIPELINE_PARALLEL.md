# 实现真正的并行管道（Cloudflare Workers 环境）

> **重要**：just-bash 主要运行在 Cloudflare Workers 环境，这是一个**单线程、基于 V8 Isolates** 的运行时，没有 Node.js streams 或真正的多线程并发。

## 当前实现

当前 `executePipeline` 方法（`src/interpreter/interpreter.ts:264-349`）是**顺序执行**的：

```typescript
private async executePipeline(node: PipelineNode): Promise<ExecResult> {
  let stdin = "";
  for (let i = 0; i < node.commands.length; i++) {
    const command = node.commands[i];
    const isLast = i === node.commands.length - 1;

    // 每个命令等待前一个完成
    result = await this.executeCommand(command, stdin);

    if (!isLast) {
      stdin = result.stdout;  // 将整个 stdout 传给下一个命令
    }
  }
}
```

**问题**：
1. 命令串行执行，不是真正的并行
2. 需要等待整个 stdout 完成才能传递给下一个命令（内存压力大）
3. 无法处理流式数据（如 `yes | head -10` 会尝试生成无限输出）

## 真正的 Bash 管道行为

在真实的 bash 中，`cmd1 | cmd2 | cmd3` 的执行方式：

1. **并行启动**：三个命令几乎同时启动
2. **管道连接**：`cmd1.stdout` → `cmd2.stdin`，`cmd2.stdout` → `cmd3.stdin`
3. **流式传输**：数据边生成边传递，不需要等待完全生成
4. **背压控制**：管道有缓冲区（通常 64KB），满了会阻塞写入方

### 示例：`yes | head -n 3`

**真实 bash**：
- `yes` 和 `head` 同时启动
- `yes` 输出几行后，`head` 读取 3 行就退出
- `yes` 收到 SIGPIPE（管道断开）也退出
- 总耗时：毫秒级

**当前 just-bash**：
- `yes` 先执行（无限循环，永不结束）
- `head` 永远等不到输入
- 结果：挂死

## Cloudflare Workers 环境限制

### 可用技术
- ✅ **Web Streams API** (`ReadableStream`, `WritableStream`, `TransformStream`)
- ✅ **Async Generators** (`async function*`)
- ✅ **Promise 并发** (`Promise.all`, `Promise.race`)
- ✅ **ArrayBuffer / Uint8Array**（二进制数据）

### 不可用技术
- ❌ Node.js `stream` 模块
- ❌ 真正的多线程（`worker_threads`）
- ❌ 真正的进程并发（`child_process`）
- ❌ POSIX 信号（`SIGPIPE`）

### 单线程并发模型

Cloudflare Workers 使用**协作式多任务**：
- 单个 JavaScript 线程
- 通过 `async/await` 实现并发
- 当一个任务 `await` 时，其他任务可以运行
- 类似 Node.js 的事件循环

这意味着管道"并行"实际上是**交错执行**（interleaved execution），而非真正的并行。

## 实现方案

### 方案 1: 使用 Web Streams API（推荐用于 Cloudflare Workers）

利用标准 Web Streams 实现流式管道：

```typescript
// 扩展命令接口（可选，保持向后兼容）
interface Command {
  // 传统同步接口（已有）
  execute(args: string[], ctx: CommandContext): Promise<ExecResult>;

  // 新的流式接口（可选实现）
  executeStream?(
    args: string[],
    ctx: CommandContext & { stdinStream: ReadableStream<string> }
  ): Promise<{ stdoutStream: ReadableStream<string>, stderr: string, exitCode: number }>;
}

// 管道执行（使用 Web Streams）
private async executePipeline(node: PipelineNode): Promise<ExecResult> {
  if (node.commands.length === 1) {
    return this.executeCommand(node.commands[0], "");
  }

  // 创建流管道链
  let currentStream: ReadableStream<string> = new ReadableStream({
    start(controller) {
      controller.enqueue("");  // 空 stdin
      controller.close();
    }
  });

  const tasks: Promise<{ stderr: string, exitCode: number }>[] = [];

  for (let i = 0; i < node.commands.length; i++) {
    const cmd = node.commands[i];

    // 启动命令（异步，不等待完成）
    const task = this.executeCommandWithStream(cmd, currentStream);
    tasks.push(task.then(r => ({ stderr: r.stderr, exitCode: r.exitCode })));

    // 更新当前流为此命令的输出
    currentStream = (await task).stdoutStream;
  }

  // 收集最后一个命令的输出
  const reader = currentStream.getReader();
  let stdout = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += value;
    }
  } finally {
    reader.releaseLock();
  }

  // 等待所有命令完成
  const results = await Promise.all(tasks);
  const exitCode = results[results.length - 1].exitCode;
  const stderr = results.map(r => r.stderr).join("");

  return { stdout, stderr, exitCode };
}

private async executeCommandWithStream(
  cmd: CommandNode,
  stdinStream: ReadableStream<string>
): Promise<{ stdoutStream: ReadableStream<string>, stderr: string, exitCode: number }> {
  // 如果命令支持流式接口，使用它
  if (this.supportsStream(cmd)) {
    return this.executeCommandStreamNative(cmd, stdinStream);
  }

  // 否则，包装传统接口
  return this.executeCommandStreamWrapped(cmd, stdinStream);
}

private async executeCommandStreamWrapped(
  cmd: CommandNode,
  stdinStream: ReadableStream<string>
): Promise<{ stdoutStream: ReadableStream<string>, stderr: string, exitCode: number }> {
  // 先消费完整 stdin（传统命令需要完整输入）
  const reader = stdinStream.getReader();
  let stdin = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdin += value;
    }
  } finally {
    reader.releaseLock();
  }

  // 执行命令
  const result = await this.executeCommand(cmd, stdin);

  // 将结果包装成流
  const stdoutStream = new ReadableStream({
    start(controller) {
      controller.enqueue(result.stdout);
      controller.close();
    }
  });

  return { stdoutStream, stderr: result.stderr, exitCode: result.exitCode };
}
```

**优点**：
- ✅ 标准 Web Streams API（Cloudflare Workers 原生支持）
- ✅ 真正的流式处理和背压控制
- ✅ 向后兼容（传统命令自动包装）
- ✅ 可逐步迁移（只需实现 `executeStream` 方法）

**缺点**：
- 需要重构高频命令（cat, grep, head, tail 等）
- 增加了一定复杂度

### 方案 2: 使用 Async Generators（简化版）

使用 JavaScript 原生的异步生成器：

```typescript
// 命令接口扩展
interface Command {
  execute(args: string[], ctx: CommandContext): Promise<ExecResult>;

  // 可选：流式生成器接口
  executeGenerator?(
    args: string[],
    ctx: CommandContext,
    stdinGen: AsyncIterable<string>
  ): AsyncGenerator<string, number>; // yield stdout chunks, return exitCode
}

// 管道执行
private async executePipeline(node: PipelineNode): Promise<ExecResult> {
  if (node.commands.length === 1) {
    return this.executeCommand(node.commands[0], "");
  }

  // 创建生成器链
  let currentGen: AsyncIterable<string> = async function*() {
    // 空 stdin
  }();

  const tasks: Promise<number>[] = [];

  for (const cmd of node.commands) {
    const gen = this.createCommandGenerator(cmd, currentGen);

    // 启动命令（Promise 化）
    tasks.push((async () => {
      let exitCode = 0;
      for await (const _ of gen) {
        exitCode = _;  // 最后的返回值是 exitCode
      }
      return exitCode;
    })());

    currentGen = gen;
  }

  // 收集最后一个命令的输出
  let stdout = "";
  for await (const chunk of currentGen) {
    stdout += chunk;
  }

  const exitCodes = await Promise.all(tasks);
  return { stdout, stderr: "", exitCode: exitCodes[exitCodes.length - 1] };
}

private async *createCommandGenerator(
  cmd: CommandNode,
  stdinGen: AsyncIterable<string>
): AsyncGenerator<string, number> {
  // 消费 stdin
  let stdin = "";
  for await (const chunk of stdinGen) {
    stdin += chunk;
  }

  // 执行命令
  const result = await this.executeCommand(cmd, stdin);

  // 产生输出
  yield result.stdout;

  return result.exitCode;
}
```

**优点**：
- ✅ 简单，无需外部依赖
- ✅ 标准 JavaScript 特性

**缺点**：
- ❌ 仍需缓冲完整 stdin（不是真正流式）
- ❌ 无背压控制

### 方案 3: 轻量级管道对象（最实用）

保持当前接口不变，仅在管道中实现并行：

```typescript
private async executePipeline(node: PipelineNode): Promise<ExecResult> {
  if (node.commands.length === 1) {
    return this.executeCommand(node.commands[0], "");
  }

  // 创建虚拟管道（内存缓冲区）
  class Pipe {
    private buffer: string[] = [];
    private closed = false;
    private readers: Array<() => void> = [];

    write(chunk: string) {
      this.buffer.push(chunk);
      this.notifyReaders();
    }

    close() {
      this.closed = true;
      this.notifyReaders();
    }

    async *read(): AsyncGenerator<string> {
      while (true) {
        while (this.buffer.length > 0) {
          yield this.buffer.shift()!;
        }
        if (this.closed) break;
        await new Promise(resolve => this.readers.push(resolve));
      }
    }

    private notifyReaders() {
      for (const resolve of this.readers) {
        resolve();
      }
      this.readers = [];
    }
  }

  // 创建管道
  const pipes: Pipe[] = [];
  for (let i = 0; i < node.commands.length - 1; i++) {
    pipes.push(new Pipe());
  }

  // 并行启动所有命令
  const tasks = node.commands.map(async (cmd, i) => {
    // 确定输入源
    let stdin = "";
    if (i > 0) {
      for await (const chunk of pipes[i - 1].read()) {
        stdin += chunk;
      }
    }

    // 执行命令
    const result = await this.executeCommand(cmd, stdin);

    // 写入到下一个管道
    if (i < node.commands.length - 1) {
      pipes[i].write(result.stdout);
      pipes[i].close();
    }

    return result;
  });

  // 等待所有命令完成
  const results = await Promise.all(tasks);

  // 返回最后一个命令的结果
  return results[results.length - 1];
}
```

**优点**：
- 不需要修改命令接口
- 实现了真正的并行执行
- 支持背压（缓冲区有限制）

**缺点**：
- 内存缓冲区可能很大（需要限制大小）
- 仍然不是真正的流式（命令内部等待完整 stdin）

## 实际挑战

### 1. 命令终止处理

真实 bash 中，如果管道中某个命令提前退出（如 `head`），会发送 SIGPIPE 给上游命令。

just-bash 需要模拟这种行为：

```typescript
// 当命令提前退出时
if (commandExited && !upstreamFinished) {
  // 通知上游命令停止
  throw new PipeClosedError();
}
```

### 2. 无限输出命令

像 `yes`、`cat /dev/urandom` 这样的命令需要能被中断：

```typescript
// yes 命令实现
async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const message = args[0] || "y";
  let stdout = "";

  // 需要一个机制来检测管道关闭
  while (!ctx.isPipeClosed()) {
    stdout += message + "\n";

    // 定期 yield 控制权
    if (stdout.length > 65536) {  // 64KB chunks
      await ctx.flushOutput(stdout);
      stdout = "";
    }
  }

  return { stdout, stderr: "", exitCode: 0 };
}
```

### 3. 浏览器兼容性

如果要支持浏览器环境，不能使用 Node.js streams。需要：

- 自定义 Stream 实现
- 或使用 Web Streams API（现代浏览器支持）

### 4. 命令计数限制

当前的 `commandCount` 限制需要调整：

```typescript
// 当前：每个命令计数 +1
// 并行时：管道算作一个单位？还是每个命令都计数？

this.ctx.state.commandCount++;  // 放在哪里？
```

## 推荐方案（针对 Cloudflare Workers）

### 短期（快速解决 `yes | head` 问题）

**方案 3（轻量级管道对象）** - 最小改动，最快见效：

```typescript
// 关键点：检测命令是否"可中断"
interface CommandContext {
  // 现有字段...
  signal?: AbortSignal;  // 新增：中断信号
}

// yes 命令改造示例
export const yesCommand: Command = {
  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    const message = args[0] || "y";
    let stdout = "";
    let lines = 0;

    // 每 1000 行检查一次中断信号
    while (!ctx.signal?.aborted) {
      stdout += message + "\n";
      lines++;

      // 每 1000 行 yield 一次（模拟流式输出）
      if (lines % 1000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));  // yield 控制权
      }
    }

    return { stdout, stderr: "", exitCode: ctx.signal?.aborted ? 141 : 0 }; // 141 = SIGPIPE
  }
};

// 管道中使用 AbortController
private async executePipeline(node: PipelineNode): Promise<ExecResult> {
  if (node.commands.length === 1) {
    return this.executeCommand(node.commands[0], "");
  }

  // 为每个命令创建 AbortController
  const controllers = node.commands.map(() => new AbortController());

  // 并行启动所有命令（但不等待完成）
  const tasks = node.commands.map(async (cmd, i) => {
    const stdin = i === 0 ? "" : ""; // TODO: 从上一个命令获取
    return this.executeCommandWithAbort(cmd, stdin, controllers[i]);
  });

  // 特殊处理：如果下游命令提前结束，中断上游
  const lastTask = tasks[tasks.length - 1];
  lastTask.then(() => {
    // 最后命令结束了，中断所有上游命令
    for (let i = 0; i < node.commands.length - 1; i++) {
      controllers[i].abort();
    }
  });

  const results = await Promise.all(tasks);
  return results[results.length - 1];
}
```

**优点**：
- ✅ 最小改动（只需修改 `yes` 等无限命令）
- ✅ 无需重构命令接口
- ✅ 快速解决挂死问题

**缺点**：
- ❌ 不是真正的流式（仍需缓冲）
- ❌ 需要手动识别"可中断"命令

### 中期（引入流式接口）

**方案 1（Web Streams API）** - 逐步迁移高频命令：

1. **阶段 1**：只改造 `cat`, `yes`, `seq` 等输出密集型命令
2. **阶段 2**：改造 `grep`, `head`, `tail` 等流处理命令
3. **阶段 3**：改造其他命令

示例：

```typescript
// cat 命令流式版本
export const catCommand: Command = {
  async execute(args, ctx): Promise<ExecResult> { /* 保持不变 */ },

  async executeStream(args, ctx): Promise<StreamResult> {
    const stream = new ReadableStream({
      async start(controller) {
        for (const file of args) {
          const content = await ctx.fs.readFile(file);
          // 分块输出（每 64KB）
          for (let i = 0; i < content.length; i += 65536) {
            controller.enqueue(content.slice(i, i + 65536));
          }
        }
        controller.close();
      }
    });

    return { stdoutStream: stream, stderr: "", exitCode: 0 };
  }
};
```

### 长期（完全流式架构）

完全基于 Web Streams 重构，类似 Deno 的标准库设计。

## 实现步骤

### 阶段 1：基础并行

1. 修改 `executePipeline` 使用 `Promise.all`
2. 实现简单的内存管道（Pipe 类）
3. 添加测试：`yes | head -n 10`

### 阶段 2：背压控制

1. 限制管道缓冲区大小
2. 实现阻塞写入
3. 添加测试：大文件管道

### 阶段 3：信号处理

1. 实现 SIGPIPE 模拟
2. 命令提前退出通知
3. 添加测试：`cat large.txt | head -n 1`

### 阶段 4：命令接口升级

1. 添加 `executeStream` 可选接口
2. 逐步迁移高频命令（cat, grep, head, tail, etc.）
3. 保持向后兼容

## 测试用例

```bash
# 基础管道
echo "hello world" | cat
echo "hello" | grep "h"

# 多级管道
echo "a\nb\nc" | head -n 2 | tail -n 1

# 无限输出 + head（关键测试）
yes | head -n 5

# 大数据量
seq 1000000 | wc -l

# 命令失败
false | echo "still runs"

# pipefail 模式
set -o pipefail
false | echo "test"  # 应该返回 1

# PIPESTATUS
echo "a" | grep "b" | wc -l
echo ${PIPESTATUS[@]}  # 应该是 "0 1 0"
```

## Cloudflare Workers 特殊考虑

### CPU 时间限制

Cloudflare Workers 有严格的 CPU 时间限制：
- **免费版**：10ms CPU 时间
- **付费版**：50ms CPU 时间（可通过 `cpu_ms` 调整）

**管道并行的影响**：
- 并行执行不会减少总 CPU 时间（单线程）
- 但可以避免无限循环导致超时

### 内存限制

- **128 MB** 内存限制
- 管道缓冲区会占用内存
- 建议使用流式处理，避免大量缓冲

### 实际建议

对于 Cloudflare Workers 环境：

1. **优先解决挂死问题**（使用 AbortSignal）
2. **逐步引入流式接口**（针对高频命令）
3. **监控 CPU 时间**（避免超时）
4. **限制缓冲区大小**（避免 OOM）

```typescript
// 示例：带 CPU 时间监控的管道
private async executePipeline(node: PipelineNode): Promise<ExecResult> {
  const startTime = Date.now();
  const MAX_DURATION = 45000; // 45秒，留 5秒余量

  // ... 执行管道 ...

  // 定期检查时间
  if (Date.now() - startTime > MAX_DURATION) {
    throw new Error("Pipeline execution timeout");
  }

  // ...
}
```

## 参考资料

- Bash 管道文档: https://www.gnu.org/software/bash/manual/bash.html#Pipelines
- Web Streams API: https://developer.mozilla.org/en-US/docs/Web/API/Streams_API
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
