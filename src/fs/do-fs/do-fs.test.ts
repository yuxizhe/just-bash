/**
 * Tests for Cloudflare Durable Objects filesystem
 *
 * Note: These tests use mock DO interfaces since we can't run actual
 * Durable Objects in the test environment.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { DoFsClient } from "./do-fs-client.js";
import { BashFileSystem } from "./do-fs-storage.js";
import type {
  DoState,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStorage,
  DurableObjectStub,
} from "./types.js";

// Mock storage implementation
class MockStorage implements DurableObjectStorage {
  private data = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(
    keyOrKeys: string | string[],
  ): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, T>();
      for (const key of keyOrKeys) {
        const value = this.data.get(key);
        if (value !== undefined) {
          result.set(key, value as T);
        }
      }
      return result;
    }
    return this.data.get(keyOrKeys) as T | undefined;
  }

  async put<T = unknown>(key: string, value: T): Promise<void>;
  async put<T = unknown>(entries: Record<string, T>): Promise<void>;
  async put<T = unknown>(
    keyOrEntries: string | Record<string, T>,
    value?: T,
  ): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.data.set(keyOrEntries, value);
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.data.set(k, v);
      }
    }
  }

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0;
      for (const key of keyOrKeys) {
        if (this.data.delete(key)) count++;
      }
      return count;
    }
    return this.data.delete(keyOrKeys);
  }

  async list<T = unknown>(): Promise<Map<string, T>> {
    return new Map(this.data as Map<string, T>);
  }

  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}

// Mock Durable Object ID
class MockDoId implements DurableObjectId {
  constructor(private id: string) {}

  toString(): string {
    return this.id;
  }

  equals(other: DurableObjectId): boolean {
    return this.id === other.toString();
  }
}

// Mock Durable Object state
class MockDoState implements DoState {
  storage: DurableObjectStorage;
  id: DurableObjectId;
  private waitUntilPromises: Promise<unknown>[] = [];

  constructor(id: string) {
    this.storage = new MockStorage();
    this.id = new MockDoId(id);
  }

  waitUntil(promise: Promise<unknown>): void {
    this.waitUntilPromises.push(promise);
  }

  async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  async waitForAll(): Promise<void> {
    await Promise.all(this.waitUntilPromises);
    this.waitUntilPromises = [];
  }
}

// Mock Durable Object stub
class MockDoStub implements DurableObjectStub {
  id: DurableObjectId;
  private doInstance: BashFileSystem;
  private state: MockDoState;

  constructor(id: string) {
    this.id = new MockDoId(id);
    this.state = new MockDoState(id);
    this.doInstance = new BashFileSystem(this.state);
  }

  async fetch(request: Request): Promise<Response> {
    const response = await this.doInstance.fetch(request);
    await this.state.waitForAll();
    return response;
  }
}

// Mock Durable Object namespace
class MockDoNamespace implements DurableObjectNamespace {
  private stubs = new Map<string, MockDoStub>();

  newUniqueId(): DurableObjectId {
    return new MockDoId(`unique-${Date.now()}-${Math.random()}`);
  }

  idFromName(name: string): DurableObjectId {
    return new MockDoId(`named-${name}`);
  }

  idFromString(hexId: string): DurableObjectId {
    return new MockDoId(hexId);
  }

  get(id: DurableObjectId): DurableObjectStub {
    const key = id.toString();
    if (!this.stubs.has(key)) {
      this.stubs.set(key, new MockDoStub(key));
    }
    const stub = this.stubs.get(key);
    if (!stub) {
      throw new Error("Stub not found");
    }
    return stub;
  }
}

describe("DoFsClient", () => {
  let namespace: DurableObjectNamespace;
  let client: DoFsClient;

  beforeEach(() => {
    namespace = new MockDoNamespace();
    client = new DoFsClient({
      namespace,
      objectName: "test-fs",
      timeout: 5000,
    });
  });

  describe("basic operations", () => {
    it("should write and read a file", async () => {
      await client.writeFile("/test.txt", "Hello World");
      const content = await client.readFile("/test.txt");
      expect(content).toBe("Hello World");
    });

    it("should write and read binary data", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      await client.writeFile("/binary.dat", data);
      const result = await client.readFileBuffer("/binary.dat");
      expect(result).toEqual(data);
    });

    it("should append to files", async () => {
      await client.writeFile("/log.txt", "Line 1\n");
      await client.appendFile("/log.txt", "Line 2\n");
      const content = await client.readFile("/log.txt");
      expect(content).toBe("Line 1\nLine 2\n");
    });

    it("should check if files exist", async () => {
      expect(await client.exists("/nonexistent")).toBe(false);
      await client.writeFile("/test.txt", "data");
      expect(await client.exists("/test.txt")).toBe(true);
    });

    it("should create directories", async () => {
      await client.mkdir("/dir", { recursive: true });
      const stat = await client.stat("/dir");
      expect(stat.isDirectory).toBe(true);
    });

    it("should list directory contents", async () => {
      await client.mkdir("/dir", { recursive: true });
      await client.writeFile("/dir/file1.txt", "data1");
      await client.writeFile("/dir/file2.txt", "data2");

      const entries = await client.readdir("/dir");
      expect(entries).toEqual(
        expect.arrayContaining(["file1.txt", "file2.txt"]),
      );
    });

    it("should remove files", async () => {
      await client.writeFile("/temp.txt", "data");
      expect(await client.exists("/temp.txt")).toBe(true);
      await client.rm("/temp.txt");
      expect(await client.exists("/temp.txt")).toBe(false);
    });

    it("should copy files", async () => {
      await client.writeFile("/source.txt", "content");
      await client.cp("/source.txt", "/dest.txt");
      const content = await client.readFile("/dest.txt");
      expect(content).toBe("content");
    });

    it("should move files", async () => {
      await client.writeFile("/old.txt", "data");
      await client.mv("/old.txt", "/new.txt");
      expect(await client.exists("/old.txt")).toBe(false);
      expect(await client.exists("/new.txt")).toBe(true);
    });
  });

  describe("symlinks", () => {
    it("should create and read symlinks", async () => {
      await client.writeFile("/target.txt", "target content");
      await client.symlink("/target.txt", "/link.txt");

      const linkTarget = await client.readlink("/link.txt");
      expect(linkTarget).toBe("/target.txt");

      const content = await client.readFile("/link.txt");
      expect(content).toBe("target content");
    });
  });

  describe("persistence", () => {
    it("should persist data across client instances", async () => {
      // Write with first client
      await client.writeFile("/persistent.txt", "persistent data");

      // Create new client with same DO
      const client2 = new DoFsClient({
        namespace,
        objectName: "test-fs", // Same name
        timeout: 5000,
      });

      // Read with second client
      const content = await client2.readFile("/persistent.txt");
      expect(content).toBe("persistent data");
    });

    it("should isolate data between different objects", async () => {
      await client.writeFile("/data.txt", "client1 data");

      const client2 = new DoFsClient({
        namespace,
        objectName: "other-fs", // Different name
        timeout: 5000,
      });

      await expect(client2.readFile("/data.txt")).rejects.toThrow();
    });
  });

  describe("error handling", () => {
    it("should throw on reading nonexistent file", async () => {
      await expect(client.readFile("/nonexistent.txt")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should throw on reading directory as file", async () => {
      await client.mkdir("/dir");
      await expect(client.readFile("/dir")).rejects.toThrow("EISDIR");
    });

    it("should throw on removing non-empty directory without recursive", async () => {
      await client.mkdir("/dir");
      await client.writeFile("/dir/file.txt", "data");
      await expect(client.rm("/dir")).rejects.toThrow("ENOTEMPTY");
    });
  });

  describe("path resolution", () => {
    it("should resolve absolute paths", () => {
      expect(client.resolvePath("/home", "/etc/config")).toBe("/etc/config");
    });

    it("should resolve relative paths", () => {
      expect(client.resolvePath("/home/user", "documents")).toBe(
        "/home/user/documents",
      );
    });

    it("should handle .. in paths", () => {
      expect(client.resolvePath("/home/user", "../other")).toBe("/home/other");
    });
  });
});

describe("BashFileSystem", () => {
  let state: MockDoState;
  let doInstance: BashFileSystem;

  beforeEach(() => {
    state = new MockDoState("test-do");
    doInstance = new BashFileSystem(state);
  });

  it("should handle POST requests", async () => {
    const request = new Request("https://do-fs/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "writeFile",
        path: "/test.txt",
        content: "test data",
      }),
    });

    const response = await doInstance.fetch(request);
    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("should reject non-POST requests", async () => {
    const request = new Request("https://do-fs/request", {
      method: "GET",
    });

    const response = await doInstance.fetch(request);
    expect(response.status).toBe(405);
  });

  it("should return errors in response body", async () => {
    const request = new Request("https://do-fs/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "readFile",
        path: "/nonexistent.txt",
      }),
    });

    const response = await doInstance.fetch(request);
    expect(response.ok).toBe(true); // Still 200

    const result = await response.json();
    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
  });
});
