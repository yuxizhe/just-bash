# just-bash Cloudflare Worker Example

This example demonstrates how to use just-bash in a Cloudflare Worker environment with persistent filesystem storage via Durable Objects.

## Overview

- **Worker**: Handles HTTP requests and executes bash commands
- **Durable Object**: Provides persistent filesystem storage across requests
- **Session-based**: Each session ID gets its own isolated filesystem
- **Interactive Web UI**: Terminal-style interface in the browser

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Run locally:
```bash
pnpm dev
```

3. Deploy to Cloudflare:
```bash
pnpm deploy
```

## Usage

### Web Interface

Open your browser and navigate to:
- Local: `http://localhost:8787`
- Production: `https://your-worker.workers.dev`

The web interface provides:
- 🖥️ **Interactive Terminal** - Type and execute bash commands in real-time
- 💾 **Persistent Storage** - Files persist across page reloads
- 🎯 **Quick Examples** - One-click command buttons
- 📊 **Session Management** - Each browser gets its own isolated filesystem
- 🎨 **Modern UI** - Beautiful terminal-style interface

Try these features:
1. Click any example button to run a command
2. Type your own commands in the input box
3. Create a file, refresh the page, and read it back - it persists!
4. Open the same URL in an incognito window for a different session

### API Endpoints

### Execute a bash command

```bash
curl "http://localhost:8787/exec?cmd=echo 'Hello World'"
```

Response:
```json
{
  "success": true,
  "stdout": "Hello World\n",
  "stderr": "",
  "exitCode": 0
}
```

### Create files and directories

```bash
curl "http://localhost:8787/exec?cmd=mkdir -p /tmp/test && echo 'data' > /tmp/test/file.txt"
```

### List files

```bash
curl "http://localhost:8787/files?dir=/tmp"
```

### Use sessions

Each session ID gets its own isolated filesystem:

```bash
# Session 1
curl "http://localhost:8787/exec?session=user1&cmd=echo 'user1 data' > /tmp/file.txt"

# Session 2
curl "http://localhost:8787/exec?session=user2&cmd=echo 'user2 data' > /tmp/file.txt"

# Each session has its own /tmp/file.txt
curl "http://localhost:8787/exec?session=user1&cmd=cat /tmp/file.txt"
# Returns: user1 data

curl "http://localhost:8787/exec?session=user2&cmd=cat /tmp/file.txt"
# Returns: user2 data
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                        │
│                                                             │
│  ┌──────────────┐                                          │
│  │ HTTP Request │                                          │
│  └──────┬───────┘                                          │
│         │                                                   │
│         v                                                   │
│  ┌──────────────────────────────────┐                      │
│  │   Bash Environment (just-bash)   │                      │
│  │   - Parser & Interpreter         │                      │
│  │   - Command execution            │                      │
│  └──────────────┬───────────────────┘                      │
│                 │                                           │
│                 │ Filesystem operations                     │
│                 v                                           │
│  ┌──────────────────────────────────┐                      │
│  │      DoFsClient (Client)         │                      │
│  │   - Serializes requests          │                      │
│  │   - Handles binary data          │                      │
│  └──────────────┬───────────────────┘                      │
└─────────────────┼───────────────────────────────────────────┘
                  │ HTTP (JSON-RPC)
                  v
┌─────────────────────────────────────────────────────────────┐
│              Durable Object (BashFileSystem)                │
│                                                             │
│  ┌──────────────────────────────────┐                      │
│  │       Request Handler            │                      │
│  │   - Deserializes requests        │                      │
│  │   - Routes to operations         │                      │
│  └──────────────┬───────────────────┘                      │
│                 │                                           │
│                 v                                           │
│  ┌──────────────────────────────────┐                      │
│  │    InMemoryFs (In-memory)        │                      │
│  │   - File operations              │                      │
│  │   - Directory tree               │                      │
│  └──────────────┬───────────────────┘                      │
│                 │                                           │
│                 │ Persist after mutations                   │
│                 v                                           │
│  ┌──────────────────────────────────┐                      │
│  │   Durable Object Storage         │                      │
│  │   - Persistent key-value store   │                      │
│  │   - Snapshots filesystem state   │                      │
│  └──────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Features

- **Persistent Storage**: Files persist across Worker invocations
- **Session Isolation**: Each session ID gets its own filesystem
- **Full Bash**: Complete bash interpreter with pipes, redirects, variables, etc.
- **Binary Support**: Handles binary files via base64 encoding
- **Edge Computing**: Runs at Cloudflare's edge for low latency

## Limitations

- **Durable Object Limits**: 128 MB per Durable Object
- **CPU Time**: Limited to 50ms per request on free tier (adjustable)
- **Request Size**: 100 MB max request/response size
- **Persistence**: Filesystem state is serialized to DO storage after mutations

## Advanced Usage

### Custom Filesystem Initialization

```typescript
import { Bash } from "just-bash";
import { DoFsClient } from "just-bash/dist/fs/do-fs/index.js";

const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: `bash-fs-${sessionId}`,
  timeout: 10000,
});

// Initialize with files
const bash = new Bash({
  fs,
  files: {
    "/home/user/.bashrc": "export PS1='$ '",
    "/etc/config.json": JSON.stringify({ setting: "value" }),
  },
});
```

### Multiple Filesystems per User

```typescript
// User's home directory
const homeFs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: `home-${userId}`,
});

// Temporary workspace
const workspaceFs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: `workspace-${workspaceId}`,
});
```

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Durable Objects Docs](https://developers.cloudflare.com/durable-objects/)
- [just-bash Documentation](../../README.md)
