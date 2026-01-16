/**
 * Example Cloudflare Worker using just-bash with Durable Objects filesystem
 *
 * This demonstrates how to use just-bash in a Cloudflare Worker environment
 * with persistent filesystem storage via Durable Objects.
 */

import { Bash } from "../../dist/index.js";
import { DoFsClient, BashFileSystem } from "../../dist/fs/do-fs/index.js";
import indexHtml from "./public/index.html";

/**
 * Worker environment bindings
 */
export interface Env {
  // Durable Object namespace binding
  BASH_FS: DurableObjectNamespace;
}

/**
 * Worker fetch handler
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Serve frontend HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Get or create a filesystem for this user/session
    // You could use user ID, session ID, etc. as the object name
    const sessionId = url.searchParams.get("session") || "default";

    const fs = new DoFsClient({
      namespace: env.BASH_FS,
      objectName: `bash-fs-${sessionId}`,
      timeout: 10000,
    });

    // Create a Bash environment with the DO filesystem
    const bash = new Bash({
      fs,
      cwd: "/",
      env: {
        USER: "user",
        HOME: "/",
        PATH: "/usr/local/bin:/usr/bin:/bin",
      },
    });

    // Handle different endpoints
    if (url.pathname === "/exec") {
      // Execute bash command
      const command = url.searchParams.get("cmd") || 'echo "Hello from Worker"';

      try {
        const result = await bash.exec(command);
        return new Response(
          JSON.stringify({
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }
    }

    if (url.pathname === "/files") {
      // List files in a directory
      const dir = url.searchParams.get("dir") || "/home/user";

      try {
        const result = await bash.exec(`ls -la ${dir}`);
        return new Response(
          JSON.stringify({
            success: true,
            output: result.stdout,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }
    }

    // API documentation endpoint
    if (url.pathname === "/api") {
      return new Response(
        JSON.stringify({
          message: "just-bash Cloudflare Worker API",
          endpoints: {
            "/": "Interactive web terminal",
            "/exec?cmd=<command>&session=<id>":
              "Execute a bash command (default session: 'default')",
            "/files?dir=<path>&session=<id>":
              "List files in directory (default: /home/user)",
            "/api": "This API documentation",
          },
          examples: [
            "/exec?cmd=echo 'Hello World'",
            "/exec?cmd=ls -la /home/user",
            "/exec?cmd=mkdir -p /tmp/test && echo 'test' > /tmp/test/file.txt",
            "/files?dir=/home/user",
          ],
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    // 404 for other paths
    return new Response("Not Found", { status: 404 });
  },
};

/**
 * Export the Durable Object class
 * This must match the class_name in wrangler.toml
 */
export { BashFileSystem };
