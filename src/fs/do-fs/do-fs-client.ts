/**
 * Cloudflare Durable Objects filesystem client
 *
 * This client communicates with a Durable Object that stores the filesystem state.
 * All filesystem operations are serialized and sent to the DO for execution.
 */

import type {
  BufferEncoding,
  CpOptions,
  DirentEntry,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../interface.js";
import type {
  DoFsConfig,
  DoFsRequest,
  DoFsResponse,
  DurableObjectStub,
} from "./types.js";

/**
 * Filesystem client that uses Cloudflare Durable Objects for storage
 */
export class DoFsClient implements IFileSystem {
  private stub: DurableObjectStub;
  private timeout: number;

  constructor(config: DoFsConfig) {
    this.timeout = config.timeout ?? 10000;

    // Get or create the Durable Object stub
    if (config.objectName) {
      const id = config.namespace.idFromName(config.objectName);
      this.stub = config.namespace.get(id);
    } else if (config.objectId) {
      const id =
        typeof config.objectId === "string"
          ? config.namespace.idFromString(config.objectId)
          : config.objectId;
      this.stub = config.namespace.get(id);
    } else {
      const id = config.namespace.newUniqueId();
      this.stub = config.namespace.get(id);
    }
  }

  /**
   * Send a request to the Durable Object
   */
  private async request<T>(req: DoFsRequest): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Serialize the request - handle Uint8Array specially
      const serializedReq = this.serializeRequest(req);

      const response = await this.stub.fetch(
        new Request("https://do-fs/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serializedReq),
          signal: controller.signal,
        }),
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`DO request failed: ${response.statusText}`);
      }

      const result = (await response.json()) as DoFsResponse<T>;

      if (!result.success) {
        throw new Error(result.error);
      }

      // Deserialize response - handle binary data
      return this.deserializeResponse(result.data) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`DO request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Serialize request, converting Uint8Array to base64
   */
  private serializeRequest(req: DoFsRequest): unknown {
    if (
      (req.type === "writeFile" || req.type === "appendFile") &&
      req.content instanceof Uint8Array
    ) {
      return {
        ...req,
        content: {
          __type: "Uint8Array",
          data: this.arrayBufferToBase64(req.content),
        },
      };
    }
    return req;
  }

  /**
   * Deserialize response, converting base64 back to Uint8Array
   */
  private deserializeResponse(data: unknown): unknown {
    if (data instanceof Uint8Array) {
      return data;
    }
    if (
      typeof data === "object" &&
      data !== null &&
      "__type" in data &&
      data.__type === "Uint8Array" &&
      "data" in data &&
      typeof data.data === "string"
    ) {
      return this.base64ToArrayBuffer(data.data);
    }
    return data;
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = "";
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToArrayBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // IFileSystem implementation

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    return this.request<string>({
      type: "readFile",
      path,
      options: typeof options === "string" ? { encoding: options } : options,
    });
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const data = await this.request<unknown>({ type: "readFileBuffer", path });
    // Response should already be deserialized to Uint8Array
    if (data instanceof Uint8Array) {
      return data;
    }
    throw new Error("Invalid response type for readFileBuffer");
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    await this.request<void>({
      type: "writeFile",
      path,
      content,
      options: typeof options === "string" ? { encoding: options } : options,
    });
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    await this.request<void>({
      type: "appendFile",
      path,
      content,
      options: typeof options === "string" ? { encoding: options } : options,
    });
  }

  async exists(path: string): Promise<boolean> {
    return this.request<boolean>({ type: "exists", path });
  }

  async stat(path: string): Promise<FsStat> {
    return this.request<FsStat>({ type: "stat", path });
  }

  async lstat(path: string): Promise<FsStat> {
    return this.request<FsStat>({ type: "lstat", path });
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.request<void>({ type: "mkdir", path, options });
  }

  async readdir(path: string): Promise<string[]> {
    return this.request<string[]>({ type: "readdir", path });
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    return this.request<DirentEntry[]>({ type: "readdirWithFileTypes", path });
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    await this.request<void>({ type: "rm", path, options });
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.request<void>({ type: "cp", src, dest, options });
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.request<void>({ type: "mv", src, dest });
  }

  resolvePath(base: string, path: string): string {
    // This can be done client-side for efficiency, but we keep it on the DO
    // to ensure consistency with the DO's path resolution logic
    // For now, we'll implement it client-side to avoid a round-trip
    if (path.startsWith("/")) {
      return this.normalizePath(path);
    }
    const combined = base === "/" ? `/${path}` : `${base}/${path}`;
    return this.normalizePath(combined);
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

  getAllPaths(): string[] {
    // This would require a sync API, which we don't have
    // For now, return empty array - callers should use async methods
    throw new Error(
      "getAllPaths is not supported in DoFsClient - use async methods instead",
    );
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.request<void>({ type: "chmod", path, mode });
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    await this.request<void>({ type: "symlink", target, linkPath });
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.request<void>({ type: "link", existingPath, newPath });
  }

  async readlink(path: string): Promise<string> {
    return this.request<string>({ type: "readlink", path });
  }

  /**
   * Get the Durable Object ID for this filesystem
   */
  getObjectId(): string {
    return this.stub.id.toString();
  }
}
