# 部署指南

## 账户配置

Worker 已配置为部署到 Cloudflare 账户：
```
Account ID: 3c181a61e54b069ab102a8c08e966237
```

## 前置要求

1. **Cloudflare 账户访问权限**
   - 确保你有该账户的访问权限
   - 需要 Workers & Pages 的编辑权限

2. **安装依赖**
   ```bash
   cd examples/cloudflare-worker
   pnpm install
   ```

## 部署步骤

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

这会打开浏览器进行身份验证。确保使用正确的 Cloudflare 账户登录。

### 2. 验证配置

检查你的登录状态：
```bash
npx wrangler whoami
```

应该显示：
```
You are logged in with an OAuth Token, associated with the email '<your-email>'.
Account Name: <account-name>
Account ID: 3c181a61e54b069ab102a8c08e966237
```

### 3. 本地测试（可选但推荐）

在部署前先本地测试：
```bash
pnpm dev
```

访问 `http://localhost:8787` 确保一切正常。

测试命令：
- 在 Web 界面执行几个命令
- 创建文件并刷新页面验证持久化
- 测试 API：`curl "http://localhost:8787/exec?cmd=ls -la"`

### 4. 部署到生产环境

```bash
pnpm deploy
```

或者直接使用 wrangler：
```bash
npx wrangler deploy
```

### 5. 部署成功

你应该看到类似输出：
```
✨ Compiled Worker successfully
🌍 Uploading...
✨ Successfully published your script to
   https://just-bash-worker.<your-subdomain>.workers.dev
```

## 访问你的 Worker

### Web 界面
打开浏览器访问：
```
https://just-bash-worker.<your-subdomain>.workers.dev
```

你会看到交互式终端界面！

### API 端点

**执行命令：**
```bash
curl "https://just-bash-worker.<your-subdomain>.workers.dev/exec?cmd=echo 'Hello from edge'"
```

**创建持久化文件：**
```bash
curl "https://just-bash-worker.<your-subdomain>.workers.dev/exec?session=test&cmd=echo 'data' > /app/test.txt"

# 读取文件（即使在不同的请求中）
curl "https://just-bash-worker.<your-subdomain>.workers.dev/exec?session=test&cmd=cat /app/test.txt"
```

**查看 API 文档：**
```bash
curl "https://just-bash-worker.<your-subdomain>.workers.dev/api"
```

## 部署配置详解

### wrangler.toml 配置

```toml
name = "just-bash-worker"              # Worker 名称
account_id = "3c181a61e54b069ab102a8c08e966237"  # 你的账户 ID
compatibility_date = "2024-01-01"      # 兼容性日期

# HTML 文件作为文本导入
[rules]
type = "Text"
globs = ["**/*.html"]

# Durable Objects 绑定
[[durable_objects.bindings]]
name = "BASH_FS"                       # 绑定名称（代码中使用）
class_name = "BashFileSystem"          # DO 类名
script_name = "just-bash-worker"       # Worker 脚本名

# DO 迁移（首次部署）
[[migrations]]
tag = "v1"
new_sqlite_classes = ["BashFileSystem"]       # 注册新的 DO 类
```

## Durable Objects 设置

### 首次部署
第一次部署时，Cloudflare 会：
1. 创建 Worker
2. 注册 BashFileSystem Durable Object 类
3. 设置绑定

### 后续更新
更新代码后重新部署：
```bash
pnpm deploy
```

Cloudflare 会：
- 更新 Worker 代码
- 保留现有的 Durable Object 实例
- 现有用户的文件系统保持不变

## 监控和管理

### Cloudflare Dashboard

访问：https://dash.cloudflare.com/

1. **Workers & Pages**
   - 查看你的 Worker
   - 查看请求统计
   - 查看错误日志

2. **Durable Objects**
   - 查看活跃的 DO 实例
   - 监控存储使用量
   - 查看请求次数

3. **Analytics**
   - 请求次数
   - CPU 时间使用
   - 错误率
   - 响应时间

### 实时日志

查看实时日志：
```bash
npx wrangler tail
```

这会显示所有请求和 console.log 输出。

### 查看 Durable Objects

列出所有 DO 实例：
```bash
npx wrangler durable-objects list
```

## 更新和维护

### 更新代码

1. 修改代码
2. 测试：`pnpm dev`
3. 部署：`pnpm deploy`

### 回滚

如果需要回滚到之前的版本：
```bash
npx wrangler rollback
```

### 删除 Worker

```bash
npx wrangler delete
```

⚠️ **注意：这会删除 Worker 但不会删除 Durable Objects 数据**

## 成本估算

### 免费套餐
- ✅ 100,000 请求/天
- ✅ 30 Durable Object 请求/天
- ✅ 1 GB DO 存储

### 付费计划（$5/月）
- 10M 请求/月
- 无限 DO 请求
- $0.50/月 每 GB DO 存储

对于演示和轻量使用，免费套餐完全够用！

## 自定义域名（可选）

### 添加自定义域名

1. 在 Cloudflare Dashboard 中
2. 进入你的 Worker
3. 点击 "Triggers" → "Custom Domains"
4. 添加你的域名（如 `bash.example.com`）

### DNS 配置

Cloudflare 会自动配置 DNS 记录。

## 故障排查

### 部署失败

**错误：Authentication error**
```bash
# 重新登录
npx wrangler logout
npx wrangler login
```

**错误：Account ID mismatch**
- 确认 wrangler.toml 中的 account_id 正确
- 确认你登录了正确的账户

**错误：Durable Object binding error**
- 确认 wrangler.toml 中的 script_name 与 name 一致
- 确认 migrations 配置正确

### Worker 运行错误

**查看错误日志：**
```bash
npx wrangler tail
```

**常见错误：**
1. **Cannot find module** - 依赖未正确打包
2. **Durable Object not found** - 绑定配置错误
3. **CPU time exceeded** - 命令执行时间过长

### Durable Objects 问题

**数据未持久化：**
- 检查 session ID 是否一致
- 确认使用了 `--allow-write` 标志（如果通过 CLI）
- 查看浏览器控制台是否有错误

**存储满了：**
- 每个 DO 限制 128 MB
- 清理旧文件或使用多个 DO

## 性能优化

### 提高响应速度

1. **使用合适的 timeout**
   ```typescript
   const fs = new DoFsClient({
     namespace: env.BASH_FS,
     objectName: sessionId,
     timeout: 10000, // 根据需要调整
   });
   ```

2. **批量命令**
   ```bash
   # 好：一条命令完成多个操作
   mkdir -p /app && cd /app && echo "test" > file.txt

   # 不好：多次请求
   mkdir -p /app
   cd /app
   echo "test" > file.txt
   ```

3. **命令超时**
   - 避免长时间运行的命令
   - 设置合理的超时时间

### 减少 DO 请求

每个文件操作都是一次 DO 请求：
- 使用管道减少操作
- 批量处理文件
- 缓存常用数据

## 安全建议

1. **验证输入**
   ```typescript
   // 在 Worker 中验证命令
   const cmd = sanitizeCommand(request.cmd);
   ```

2. **限制访问**
   - 添加身份验证
   - 使用 Cloudflare Access
   - 限制 session 创建

3. **监控使用**
   - 设置告警
   - 监控异常活动
   - 定期检查日志

## 下一步

部署成功后，你可以：

1. **分享链接** - 让其他人体验 Web 终端
2. **自定义 UI** - 修改 `public/index.html`
3. **添加功能** - 扩展 Worker 功能
4. **集成应用** - 将 bash 能力集成到你的应用

## 支持

遇到问题？

- 📖 查看 [QUICKSTART.md](./QUICKSTART.md)
- 📚 阅读 [完整文档](../../docs/cloudflare-workers.md)
- 🐛 [提交 Issue](https://github.com/vercel-labs/just-bash/issues)
- 💬 Cloudflare Discord 社区

祝部署顺利！🚀
