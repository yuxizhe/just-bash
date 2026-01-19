# 方案 3: 轻量级管道对象 (Lightweight Pipeline Objects) 详解

根据 `PIPELINE_PARALLEL.md` 文件内容，**方案 3：轻量级管道对象** 是一种在 Cloudflare Workers 单线程环境下模拟 Bash 并行管道的架构方案。

它被描述为“最实用（Most Practical）”的折中方案，主要目的是在不重构现有命令接口的前提下，将原本的**串行执行**模型转变为**并行启动**模型。

## 1. 核心理念

*   **目标**：解决当前 `executePipeline` 实现中 `cmd1 | cmd2` 必须等 `cmd1` 完全运行结束才能启动 `cmd2` 的问题。
*   **手段**：引入一个中间的 `Pipe` 类作为缓冲区，并使用 `Promise.all` 同时启动所有命令。
*   **环境适应**：针对 Cloudflare Workers 这种没有 Node.js `stream` 模块和真正多线程的环境，利用 `AsyncGenerator`（异步生成器）来实现数据的传递。

## 2. 核心组件：`Pipe` 类

这是一个运行在内存中的虚拟管道对象，用于连接两个命令。它充当生产者和消费者之间的桥梁。

```typescript
class Pipe {
  private buffer: string[] = [];           // 内存缓冲区
  private readers: Array<() => void> = []; // 等待读取的“消费者”队列
  private closed = false;

  // 写入数据（生产者调用）
  write(chunk: string) {
    this.buffer.push(chunk);
    this.notifyReaders(); // 唤醒等待的读取者
  }

  // 关闭管道
  close() {
    this.closed = true;
    this.notifyReaders();
  }

  // 读取数据（消费者调用） - 使用异步生成器
  async *read(): AsyncGenerator<string> {
    while (true) {
      // 消费缓冲区
      while (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      }
      if (this.closed) break;
      // 缓冲区空了但没关闭，暂停等待
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
```

## 3. 执行流程的变化

### (A) 原有方案（串行）
目前的 `just-bash` 实现是：
1.  运行 `cmd1`（等待直到结束），收集完整的 `stdout`。
2.  将 `cmd1` 的 `stdout` 赋值给 `stdin` 变量。
3.  运行 `cmd2`，传入完整的 `stdin`。

**缺点**：必须等前一个命令完全结束。无法利用等待时间，也无法处理需要流式交互的场景。

### (B) 方案 3（并行 + 管道对象）
新的执行流程如下：
1.  创建 `Pipe` 对象数组。
2.  使用 `Promise.all` **同时启动** `cmd1` 和 `cmd2`。
    *   **cmd1 任务**：执行命令 -> 将结果分块（或一次性）写入 `Pipe` -> 结束时关闭 `Pipe`。
    *   **cmd2 任务**：监听 `Pipe` -> 通过 `pipe.read()` 读取数据 -> 拼凑成 `stdin` -> 传入命令执行。

```typescript
// 伪代码逻辑
const tasks = node.commands.map(async (cmd, i) => {
  // 1. 准备输入
  let stdin = "";
  if (i > 0) {
    // 从上一个管道读取数据
    for await (const chunk of pipes[i - 1].read()) {
      stdin += chunk;
    }
  }

  // 2. 执行命令 (注意：此时仍然是拿到完整 stdin 后执行)
  const result = await this.executeCommand(cmd, stdin);

  // 3. 写入输出到下一个管道
  if (i < node.commands.length - 1) {
    pipes[i].write(result.stdout);
    pipes[i].close();
  }

  return result;
});

await Promise.all(tasks);
```

## 4. 优缺点分析

### 优点 (Pros)
1.  **架构并行化**：实现了真正的“并发启动”。这更接近真实 Bash 的行为（在 Bash 中，所有管道命令是同时启动的）。
2.  **无需大幅重构**：现有的命令接口（接收 `string[] args` 和 `full_stdin`）不需要改变。方案 3 在管道层面做了适配，消费者会把管道数据重新组装成字符串再传给命令。
3.  **支持背压 (Backpressure) 的基础**：虽然上述简易示例未实现，但 `Pipe` 类可以很容易添加逻辑，比如“缓冲区满时阻塞 `write`”，从而防止内存溢出。

### 缺点与局限 (Cons)
1.  **伪流式 (Pseudo-Streaming)**：
    *   虽然命令是并行启动的，但因为现有的命令实现（如 `grep`）通常需要读取**完整的 stdin** 才能开始逻辑处理。
    *   **结果**：对于传统命令，数据处理在逻辑上仍然是“收集-处理”模式，而非“边读边写”。消费者实际上会阻塞在收集 `stdin` 的阶段，直到上游写完。
2.  **内存压力**：数据被缓冲在 `Pipe` 对象和消费者的 `stdin` 字符串变量中，对于大文件可能会占用大量内存，触碰 Workers 的内存限制。
3.  **无限流死锁风险**：如果 `cmd1` 是无限输出（如 `yes`），且 `cmd2`（如 `head`）等待完整输入，那么 `cmd2` 永远收集不完 `stdin`，永远不会开始执行逻辑，也不会发出停止信号，导致整个管道挂死。

## 5. 总结

**方案 3** 是从“完全串行”迈向“流式架构”的重要过渡方案。它搭建了并行执行的骨架（`Pipe` 类和 `Promise.all`），使得未来可以通过修改单个命令（让命令支持分块读取 `Pipe` 而不是等待完整 `String`）来实现真正的流式处理，而不需要推翻整个解释器的执行逻辑。

在实际落地时（如 Cloudflare Workers 环境），建议以此方案为基础，并引入 **`AbortController`** 来解决无限流（如 `yes | head`）导致的死循环问题。
