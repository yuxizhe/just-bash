# Quick Start Guide

Get just-bash running on Cloudflare Workers in 5 minutes!

## Prerequisites

- Node.js 18+ and pnpm installed
- Cloudflare account (free tier works!)
- 5 minutes of your time

## Installation

### 1. Install Dependencies

```bash
cd examples/cloudflare-worker
pnpm install
```

### 2. Run Locally

```bash
pnpm dev
```

You should see:
```
⛅️ wrangler 3.109.0
-------------------
⎔ Starting local server...
✨ Compiled Worker successfully
✨ Local server started at http://localhost:8787
```

### 3. Open Browser

Navigate to: **http://localhost:8787**

You'll see a beautiful terminal interface! 🎉

## Try It Out

### In the Web Terminal

Click the example buttons or type commands:

```bash
# Create a file
echo 'Hello from the edge!' > /app/hello.txt

# Read it back
cat /app/hello.txt

# Create a directory
mkdir -p /workspace/project

# Navigate and create files
cd /workspace/project
echo 'console.log("test")' > app.js
ls -la

# Refresh the browser (F5)
# Then run:
cat /workspace/project/app.js
# It's still there! 💾
```

### Using the API

Test the API with curl:

```bash
# Execute a command
curl "http://localhost:8787/exec?cmd=echo 'Hello World'"

# With custom session
curl "http://localhost:8787/exec?session=mytest&cmd=pwd"

# List files
curl "http://localhost:8787/files?dir=/home/user"
```

## Deploy to Production

### 1. Login to Cloudflare

```bash
npx wrangler login
```

This opens your browser for authentication.

### 2. Deploy

```bash
pnpm deploy
```

Output:
```
✨ Compiled Worker successfully
✨ Successfully published your script
✨ https://just-bash-worker.your-subdomain.workers.dev
```

### 3. Visit Your Live Site

Open the URL from step 2 in your browser!

Your just-bash terminal is now running at Cloudflare's edge! 🌍

## What Just Happened?

1. **Worker Deployed**: Your Worker is running on Cloudflare's edge network
2. **Durable Object Created**: Persistent storage for your filesystem
3. **Global CDN**: Terminal accessible from anywhere in the world
4. **Auto HTTPS**: Secure by default

## Next Steps

### Customize Your Worker

Edit `worker.ts`:

```typescript
// Change default working directory
const bash = new Bash({
  fs,
  cwd: "/workspace",  // Changed from /home/user
  env: {
    USER: "developer",  // Changed from user
    HOME: "/workspace",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  },
});
```

### Add Initial Files

```typescript
const bash = new Bash({
  fs,
  files: {
    "/README.md": "# Welcome to my bash terminal!",
    "/scripts/hello.sh": "#!/bin/bash\necho 'Hello!'",
    "/.profile": "export PS1='$ '",
  },
});
```

### Custom Domain

In Cloudflare dashboard:
1. Go to Workers & Pages
2. Select your Worker
3. Click "Triggers"
4. Add Custom Domain

### Monitor Usage

View stats in Cloudflare dashboard:
- Requests per day
- CPU time usage
- Durable Object operations
- Error rates

## Troubleshooting

### Port Already in Use

```bash
# Use different port
pnpm dev --port 8788
```

### Deployment Errors

```bash
# Check if logged in
npx wrangler whoami

# Re-login if needed
npx wrangler login
```

### Durable Objects Not Working

Make sure wrangler.toml has:
```toml
[[durable_objects.bindings]]
name = "BASH_FS"
class_name = "BashFileSystem"
script_name = "just-bash-worker"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["BashFileSystem"]
```

### Frontend Not Loading

Check that wrangler.toml has:
```toml
[rules]
type = "Text"
globs = ["**/*.html"]
```

## Architecture

```
User Browser
    │
    │ HTTPS
    ↓
Cloudflare Edge
    │
    │ Your Worker
    ↓
just-bash Interpreter
    │
    │ JSON-RPC
    ↓
Durable Object
    │
    └─ Persistent Storage
```

## Costs

**Free Tier Includes:**
- 100,000 requests/day
- 30 Durable Object requests/day
- 1 GB Durable Object storage
- Global CDN
- HTTPS

**Paid Plans:**
- $5/month for 10M requests
- $0.50/month per GB of DO storage
- No minimum charge

## Resources

- **Example Code**: `examples/cloudflare-worker/`
- **API Docs**: http://localhost:8787/api
- **Full Docs**: `docs/cloudflare-workers.md`
- **Wrangler Docs**: https://developers.cloudflare.com/workers/

## Common Use Cases

### 1. Educational Platform

```typescript
// Pre-load tutorial files
const bash = new Bash({
  fs,
  files: {
    "/tutorial/lesson1.txt": "Welcome to Lesson 1...",
    "/tutorial/lesson2.txt": "Now let's learn about pipes...",
  },
});
```

### 2. Code Playground

```typescript
// Allow users to test scripts
const bash = new Bash({
  fs,
  cwd: "/playground",
  env: { ...env, SANDBOX: "true" },
});
```

### 3. CI/CD Dashboard

```typescript
// Execute build commands
const result = await bash.exec(buildScript);
return Response.json({
  status: result.exitCode === 0 ? "success" : "failed",
  output: result.stdout,
});
```

### 4. Admin Tools

```typescript
// Session per admin user
const fs = new DoFsClient({
  namespace: env.BASH_FS,
  objectName: `admin-${userId}`,
});
```

## Tips

1. **Session Strategy**: Use meaningful session IDs
   ```typescript
   const sessionId = `${userId}-${workspaceId}`;
   ```

2. **Error Handling**: Always catch and log errors
   ```typescript
   try {
     const result = await bash.exec(cmd);
   } catch (error) {
     console.error("Command failed:", error);
   }
   ```

3. **Timeouts**: Set appropriate timeouts
   ```typescript
   const fs = new DoFsClient({
     namespace: env.BASH_FS,
     objectName: sessionId,
     timeout: 30000, // 30 seconds
   });
   ```

4. **Security**: Validate user input
   ```typescript
   const cmd = sanitizeCommand(request.cmd);
   ```

## Support

- **GitHub Issues**: Report bugs and feature requests
- **Discord**: Join the community
- **Documentation**: Read the full docs
- **Examples**: Check other examples

## Next: Explore Features

Now that you're running, check out:
- `DEMO.md` - See all features in action
- `FRONTEND_FEATURES.md` - Deep dive into UI
- `../../../docs/cloudflare-workers.md` - Advanced patterns

Happy coding! 🚀
