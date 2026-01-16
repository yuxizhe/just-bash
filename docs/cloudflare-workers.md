# Cloudflare Workers Integration

This guide explains how to use just-bash in Cloudflare Workers with persistent filesystem storage via Durable Objects.

## Overview

just-bash can run in Cloudflare Workers using the Durable Objects filesystem (`DoFsClient`), which provides:

- **Persistent Storage**: Files persist across Worker invocations
- **Session Isolation**: Each Durable Object has its own isolated filesystem
- **Edge Computing**: Low latency execution at Cloudflare's edge
- **Binary Support**: Full support for binary files via base64 encoding

## Architecture

```
Worker (stateless)
  ↓
Bash Environment
  ↓
DoFsClient (client)
  ↓ HTTP/JSON-RPC
Durable Object (stateful)
  ↓
InMemoryFs (in-memory state)
  ↓
DO Storage (persistent)
```

## Quick Start

### 1. Install Dependencies

```bash
npm install just-bash wrangler
npm install -D @cloudflare/workers-types
```

### 2. Configure Wrangler

Create `wrangler.toml`:

```toml
name = "my-bash-worker"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "BASH_FS"
class_name = "BashFileSystem"
script_name = "my-bash-worker"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["BashFileSystem"]
```

### 3. Create Worker

Create `src/worker.ts`:

```typescript
import { Bash } from "just-bash";
import { DoFsClient, BashFileSystem } from "just-bash/dist/fs/do-fs/index.js";

export interface Env {
  BASH_FS: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Create filesystem client backed by Durable Object
    const fs = new DoFsClient({
      namespace: env.BASH_FS,
      objectName: "my-session", // Use user ID, session ID, etc.
      timeout: 10000,
    });

    // Create Bash environment
    const bash = new Bash({ fs });

    // Execute command from query parameter
    const url = new URL(request.url);
    const cmd = url.searchParams.get("cmd") || 'echo "Hello"';

    try {
      const result = await bash.exec(cmd);
      return new Response(
        JSON.stringify({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ error: String(error) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};

// Export the Durable Object class
export { BashFileSystem };
```

### 4. Deploy

```bash
npx wrangler deploy
```

### 5. Test

```bash
curl "https://my-bash-worker.workers.dev?cmd=echo 'Hello World'"
# {"stdout":"Hello World\n","stderr":"","exitCode":0}

curl "https://my-bash-worker.workers.dev?cmd=mkdir -p /app && echo 'data' > /app/file.txt"
# Creates persistent files in the Durable Object
```

## Session Management

Each Durable Object ID represents an isolated filesystem. Use different strategies based on your needs:

### User-Based Isolation

```typescript
const userId = getUserId(request);
const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: `user-${userId}`,
});
```

### Workspace Isolation

```typescript
const workspaceId = getWorkspaceId(request);
const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: `workspace-${workspaceId}`,
});
```

### Temporary Sessions

```typescript
// Generate unique ID for temporary session
const sessionId = crypto.randomUUID();
const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: `temp-${sessionId}`,
});
```

### Using Object IDs Directly

```typescript
// Use a specific DO ID (e.g., from a database)
const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectId: storedObjectId,
});

// Get the ID to store for later use
const objectId = fs.getObjectId();
```

## Advanced Usage

### Initialize with Files

```typescript
const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: "session-123",
});

const bash = new Bash({
  fs,
  files: {
    "/etc/config.json": JSON.stringify({ setting: "value" }),
    "/home/user/.bashrc": "export PS1='$ '",
    "/app/script.sh": "#!/bin/bash\necho 'Hello from script'",
  },
});
```

### Custom Timeout

```typescript
const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: "session-123",
  timeout: 30000, // 30 seconds
});
```

### Handle Long-Running Commands

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const fs = new DoFsClient({
      namespace: env.BASH_FS,
      objectName: "session-123",
      timeout: 30000, // Increase timeout for long commands
    });

    const bash = new Bash({ fs });

    // Use ctx.waitUntil for background persistence
    const result = await bash.exec(longRunningCommand);

    return new Response(JSON.stringify(result));
  },
};
```

### Error Handling

```typescript
try {
  const result = await bash.exec(command);
  return new Response(JSON.stringify(result));
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes("timeout")) {
      return new Response(
        JSON.stringify({ error: "Command timed out" }),
        { status: 504 },
      );
    }
    if (error.message.includes("ENOENT")) {
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { status: 404 },
      );
    }
  }
  return new Response(
    JSON.stringify({ error: "Internal server error" }),
    { status: 500 },
  );
}
```

## Limitations

### Durable Objects Limits

- **Storage**: 128 MB per Durable Object
- **CPU Time**: 50ms per request (free tier), adjustable on paid plans
- **Request Size**: 100 MB max request/response size
- **Concurrency**: Durable Objects process requests sequentially

### Performance Considerations

1. **Minimize Round-Trips**: Each filesystem operation requires a DO request
2. **Batch Operations**: Use compound commands instead of multiple exec calls
3. **Cache Reads**: Store frequently accessed data in Worker memory
4. **Monitor Size**: Keep filesystems under the 128 MB limit

### Best Practices

```typescript
// Good: Single command with pipe
await bash.exec("cat data.txt | grep pattern | wc -l");

// Less efficient: Multiple round-trips
const cat = await bash.exec("cat data.txt");
const grep = await bash.exec(`echo "${cat.stdout}" | grep pattern`);
const wc = await bash.exec(`echo "${grep.stdout}" | wc -l`);
```

## Monitoring

### Track Storage Usage

The filesystem snapshot is stored in Durable Object storage. Monitor the size:

```typescript
// In your Durable Object class
class BashFileSystem {
  async getStorageSize(): Promise<number> {
    const snapshot = await this.state.storage.get<FsSnapshot>(STORAGE_KEY);
    return JSON.stringify(snapshot).length;
  }
}
```

### Request Logging

```typescript
export default {
  async fetch(request: Request, env: Env) {
    const start = Date.now();

    try {
      // ... execute command ...
      const duration = Date.now() - start;
      console.log(`Command executed in ${duration}ms`);
      return response;
    } catch (error) {
      console.error("Command failed:", error);
      throw error;
    }
  },
};
```

## Example: RESTful API

```typescript
import { Bash } from "just-bash";
import { DoFsClient, BashFileSystem } from "just-bash/dist/fs/do-fs/index.js";

interface Env {
  BASH_FS: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const session = url.searchParams.get("session") || "default";

    const fs = new DoFsClient({
      namespace: env.BASH_FS,
      objectName: `session-${session}`,
    });

    const bash = new Bash({ fs, cwd: "/app" });

    // POST /exec - Execute command
    if (request.method === "POST" && url.pathname === "/exec") {
      const { command } = await request.json();
      const result = await bash.exec(command);
      return Response.json(result);
    }

    // GET /files/:path - Read file
    if (request.method === "GET" && url.pathname.startsWith("/files/")) {
      const path = url.pathname.slice(7);
      const result = await bash.exec(`cat ${path}`);
      return new Response(result.stdout);
    }

    // PUT /files/:path - Write file
    if (request.method === "PUT" && url.pathname.startsWith("/files/")) {
      const path = url.pathname.slice(7);
      const content = await request.text();
      await bash.exec(`cat > ${path}`, { stdin: content });
      return new Response("OK");
    }

    // DELETE /files/:path - Delete file
    if (request.method === "DELETE" && url.pathname.startsWith("/files/")) {
      const path = url.pathname.slice(7);
      await bash.exec(`rm ${path}`);
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  },
};

export { BashFileSystem };
```

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Example Worker](../examples/cloudflare-worker/)
