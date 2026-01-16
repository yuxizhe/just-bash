# Interactive Demo

## Live Web Terminal

The Worker includes a beautiful, interactive web terminal interface that demonstrates the full power of just-bash running at the edge.

### Features

#### 🖥️ Terminal Interface
```
╭───────────────────────────────────────────────╮
│ ● ● ●  just-bash @ Cloudflare Workers        │
├───────────────────────────────────────────────┤
│                                               │
│ 🚀 Welcome to just-bash on Cloudflare!       │
│ This is a live bash interpreter running       │
│ at the edge with persistent storage.          │
│                                               │
│ $ echo 'Hello from the edge! 🌍'             │
│ Hello from the edge! 🌍                       │
│                                               │
│ $ mkdir -p /app/data && ls -la /app          │
│ drwxr-xr-x 3 user user 96 Jan 16 2026 .      │
│ drwxr-xr-x 5 user user 160 Jan 16 2026 ..    │
│ drwxr-xr-x 2 user user 64 Jan 16 2026 data   │
│                                               │
│ $ echo 'Persistent!' > /app/test.txt        │
│                                               │
│ $ cat /app/test.txt                          │
│ Persistent!                                   │
│                                               │
├───────────────────────────────────────────────┤
│ [Enter command here...          ] [Execute]  │
├───────────────────────────────────────────────┤
│ Quick Examples:                               │
│ [Echo] [PWD] [List Files] [Create Dir]       │
│ [Write File] [Date] [System Info] [Find]     │
├───────────────────────────────────────────────┤
│ Session: user-a1b2c3d  │  Durable Objects    │
╰───────────────────────────────────────────────╯
```

#### 💾 Persistent Storage Demo

1. **Create a file:**
   ```bash
   echo 'My persistent data!' > /app/myfile.txt
   ```

2. **Refresh the browser** (Ctrl+R or F5)

3. **Read the file back:**
   ```bash
   cat /app/myfile.txt
   # Output: My persistent data!
   ```

The file persists because it's stored in a Cloudflare Durable Object!

#### 🎯 Quick Example Buttons

Click any button to instantly run a command:

- **Echo** - `echo 'Hello from the edge! 🌍'`
- **PWD** - `pwd`
- **List Files** - `ls -la`
- **Create Directory** - `mkdir -p /app/data && echo 'Success!' && ls -la /app`
- **Write & Read File** - `echo 'Persistent data!' > /app/test.txt && cat /app/test.txt`
- **Date** - `date`
- **System Info** - `uname -a`
- **Find Files** - `find /home -type f`
- **Search** - `grep -r 'user' /etc`

#### 🔒 Session Isolation

Each browser session gets its own isolated filesystem:

1. **Session A** (normal window):
   ```bash
   $ echo 'Session A data' > /tmp/mydata.txt
   $ cat /tmp/mydata.txt
   Session A data
   ```

2. **Session B** (incognito window):
   ```bash
   $ cat /tmp/mydata.txt
   Error: ENOENT: no such file or directory
   # Different session = different filesystem!

   $ echo 'Session B data' > /tmp/mydata.txt
   $ cat /tmp/mydata.txt
   Session B data
   ```

## UI Highlights

### Design Features

- **Dark Theme** - Easy on the eyes
- **Syntax Highlighting** - Different colors for commands, output, and errors
- **Auto-scroll** - Terminal automatically scrolls to latest output
- **Responsive** - Works on mobile and desktop
- **Loading States** - Visual feedback while commands execute
- **Error Handling** - Clear error messages with color coding

### Color Scheme

- 🟢 **Green** - Success messages and prompts
- 🔵 **Blue** - Commands and buttons
- ⚪ **White** - Standard output
- 🔴 **Red** - Errors and stderr
- ⚫ **Dark Background** - Terminal background

## Example Session

```
🚀 Welcome to just-bash on Cloudflare Workers!

$ ls -la
total 0
drwxr-xr-x 3 user user 96 Jan 16 2026 .
drwxr-xr-x 5 user user 160 Jan 16 2026 ..

$ mkdir -p workspace/project
$ cd workspace/project
$ pwd
/home/user/workspace/project

$ echo 'console.log("Hello World")' > app.js
$ cat app.js
console.log("Hello World")

$ ls -lh
total 32
-rw-r--r-- 1 user user 32 Jan 16 2026 app.js

$ echo '{"name":"my-app"}' > package.json
$ cat package.json | grep name
{"name":"my-app"}

$ echo 'All files persist! Refresh the page and try: cat app.js'
All files persist! Refresh the page and try: cat app.js

[Page Refresh]

$ cat workspace/project/app.js
console.log("Hello World")
# It's still there! 🎉
```

## Technical Details

### Frontend
- Pure HTML/CSS/JavaScript (no frameworks)
- Vanilla DOM manipulation for performance
- localStorage for session ID persistence
- Fetch API for command execution
- Real-time command history in terminal

### Backend
- Cloudflare Worker (stateless)
- Durable Objects for persistent storage
- just-bash interpreter
- Session-based filesystem isolation
- JSON API for command execution

### Communication
```
Browser ─HTTP→ Worker ─JSON-RPC→ Durable Object
   ↑                                    │
   └────────── JSON Response ───────────┘
```

## Live Demo URLs

After deployment, you'll get:

- **Homepage**: `https://your-worker.workers.dev/`
- **API Docs**: `https://your-worker.workers.dev/api`
- **Execute**: `https://your-worker.workers.dev/exec?cmd=<command>&session=<id>`

## Screenshot Description

The interface features:
- A gradient purple background (modern, eye-catching)
- A centered terminal window with rounded corners and shadow
- Window control dots (red, yellow, green) in the header
- Dark theme terminal with proper monospace font
- Scrollable output area with syntax highlighting
- Command input box with execute button
- Quick example buttons in a grid layout
- Session info bar at the bottom

Perfect for:
- Demos and presentations
- Testing bash scripts
- Learning bash commands
- Rapid prototyping
- Edge computing experiments
