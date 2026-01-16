/**
 * Cloudflare Durable Object for filesystem storage
 *
 * This Durable Object handles all filesystem operations and persists state
 * in Durable Object storage. It wraps an InMemoryFs and syncs to/from storage.
 */

import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import type { FsEntry, InitialFiles } from "../interface.js";
import type {
  DoFsRequest,
  DoFsResponse,
  DoState,
  FsSnapshot,
  SerializedFsEntry,
} from "./types.js";

const STORAGE_KEY = "fs:entries";
const SNAPSHOT_VERSION = 1;

/**
 * Durable Object class for filesystem storage
 *
 * Usage in wrangler.toml:
 * ```toml
 * [[durable_objects.bindings]]
 * name = "BASH_FS"
 * class_name = "BashFileSystem"
 * ```
 */
export class BashFileSystem {
  private state: DoState;
  private fs: InMemoryFs;
  private initialized = false;

  constructor(state: DoState) {
    this.state = state;
    this.fs = new InMemoryFs();
  }

  /**
   * Initialize the filesystem from durable storage
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const stored = await this.state.storage.get<FsSnapshot>(STORAGE_KEY);
      if (stored && stored.version === SNAPSHOT_VERSION) {
        await this.restoreFromSnapshot(stored);
      }
    } catch (error) {
      console.error("Failed to load filesystem from storage:", error);
    }

    this.initialized = true;
  }

  /**
   * Persist the current filesystem state to durable storage
   */
  private async persist(): Promise<void> {
    const snapshot = this.createSnapshot();
    await this.state.storage.put(STORAGE_KEY, snapshot);
  }

  /**
   * Create a snapshot of the current filesystem
   */
  private createSnapshot(): FsSnapshot {
    const entries: Record<string, SerializedFsEntry> = {};
    const paths = this.fs.getAllPaths();

    for (const path of paths) {
      try {
        const entry = this.getEntry(path);
        if (entry) {
          entries[path] = this.serializeEntry(entry);
        }
      } catch {
        // Skip entries that can't be serialized
      }
    }

    return {
      version: SNAPSHOT_VERSION,
      entries,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Restore filesystem from a snapshot
   */
  private async restoreFromSnapshot(snapshot: FsSnapshot): Promise<void> {
    const files: InitialFiles = {};

    for (const [path, entry] of Object.entries(snapshot.entries)) {
      if (entry.type === "file") {
        const content = entry.isBase64
          ? this.base64ToUint8Array(entry.content)
          : entry.content;

        files[path] = {
          content,
          mode: entry.mode,
          mtime: new Date(entry.mtime),
        };
      }
      // Directories will be created automatically by file writes
    }

    this.fs = new InMemoryFs(files);

    // Restore directories and symlinks
    for (const [path, entry] of Object.entries(snapshot.entries)) {
      if (entry.type === "directory" && path !== "/") {
        await this.fs.mkdir(path, { recursive: true });
        await this.fs.chmod(path, entry.mode);
      } else if (entry.type === "symlink") {
        await this.fs.symlink(entry.target, path);
      }
    }
  }

  /**
   * Serialize a filesystem entry
   */
  private serializeEntry(entry: FsEntry): SerializedFsEntry {
    if (entry.type === "file") {
      let content: string;
      let isBase64 = false;

      if (entry.content instanceof Uint8Array) {
        content = this.uint8ArrayToBase64(entry.content);
        isBase64 = true;
      } else {
        content = entry.content;
        isBase64 = false;
      }

      return {
        type: "file",
        content,
        isBase64,
        mode: entry.mode,
        mtime: entry.mtime.toISOString(),
      };
    }

    if (entry.type === "directory") {
      return {
        type: "directory",
        mode: entry.mode,
        mtime: entry.mtime.toISOString(),
      };
    }

    return {
      type: "symlink",
      target: entry.target,
      mode: entry.mode,
      mtime: entry.mtime.toISOString(),
    };
  }

  /**
   * Get raw entry from filesystem (internal use)
   */
  private getEntry(path: string): FsEntry | undefined {
    // Access private data map - this is a hack but needed for serialization
    // biome-ignore lint: accessing private member for serialization
    const data = (this.fs as any).data as Map<string, FsEntry>;
    return data.get(this.normalizePath(path));
  }

  private normalizePath(path: string): string {
    if (!path || path === "/") return "/";
    let normalized =
      path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }
    const parts = normalized.split("/").filter((p) => p && p !== ".");
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return `/${resolved.join("/")}` || "/";
  }

  /**
   * Convert Uint8Array to base64
   */
  private uint8ArrayToBase64(buffer: Uint8Array): string {
    let binary = "";
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    await this.initialize();

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await request.json();
      const req = this.deserializeRequest(body) as DoFsRequest;
      const result = await this.handleRequest(req);

      // Persist after successful mutation
      if (this.isMutatingOperation(req.type)) {
        this.state.waitUntil(this.persist());
      }

      const response: DoFsResponse = {
        success: true,
        data: this.serializeResponse(result),
      };

      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      const response: DoFsResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };

      return new Response(JSON.stringify(response), {
        status: 200, // Still return 200 with error in body
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Check if an operation mutates the filesystem
   */
  private isMutatingOperation(type: string): boolean {
    return [
      "writeFile",
      "appendFile",
      "mkdir",
      "rm",
      "cp",
      "mv",
      "chmod",
      "symlink",
      "link",
      "restore",
    ].includes(type);
  }

  /**
   * Deserialize request from JSON
   */
  private deserializeRequest(body: unknown): DoFsRequest {
    if (typeof body !== "object" || body === null) {
      throw new Error("Invalid request body");
    }

    const req = body as Record<string, unknown>;

    // Handle Uint8Array in writeFile/appendFile
    if (
      (req.type === "writeFile" || req.type === "appendFile") &&
      typeof req.content === "object" &&
      req.content !== null &&
      "__type" in req.content &&
      req.content.__type === "Uint8Array" &&
      "data" in req.content &&
      typeof req.content.data === "string"
    ) {
      return {
        ...req,
        content: this.base64ToUint8Array(req.content.data),
      } as DoFsRequest;
    }

    return body as DoFsRequest;
  }

  /**
   * Serialize response to JSON
   */
  private serializeResponse(data: unknown): unknown {
    if (data instanceof Uint8Array) {
      return {
        __type: "Uint8Array",
        data: this.uint8ArrayToBase64(data),
      };
    }
    return data;
  }

  /**
   * Handle a filesystem request
   */
  private async handleRequest(req: DoFsRequest): Promise<unknown> {
    switch (req.type) {
      case "readFile":
        return this.fs.readFile(req.path, req.options);

      case "readFileBuffer":
        return this.fs.readFileBuffer(req.path);

      case "writeFile":
        return this.fs.writeFile(req.path, req.content, req.options);

      case "appendFile":
        return this.fs.appendFile(req.path, req.content, req.options);

      case "exists":
        return this.fs.exists(req.path);

      case "stat":
        return this.fs.stat(req.path);

      case "lstat":
        return this.fs.lstat(req.path);

      case "mkdir":
        return this.fs.mkdir(req.path, req.options);

      case "readdir":
        return this.fs.readdir(req.path);

      case "readdirWithFileTypes":
        return this.fs.readdirWithFileTypes(req.path);

      case "rm":
        return this.fs.rm(req.path, req.options);

      case "cp":
        return this.fs.cp(req.src, req.dest, req.options);

      case "mv":
        return this.fs.mv(req.src, req.dest);

      case "chmod":
        return this.fs.chmod(req.path, req.mode);

      case "symlink":
        return this.fs.symlink(req.target, req.linkPath);

      case "link":
        return this.fs.link(req.existingPath, req.newPath);

      case "readlink":
        return this.fs.readlink(req.path);

      case "resolvePath":
        return this.fs.resolvePath(req.base, req.path);

      case "getAllPaths":
        return this.fs.getAllPaths();

      case "snapshot":
        return this.createSnapshot();

      case "restore":
        await this.restoreFromSnapshot(req.snapshot);
        return undefined;

      default:
        throw new Error(
          `Unknown request type: ${(req as { type: string }).type}`,
        );
    }
  }
}
