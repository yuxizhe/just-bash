/**
 * Types for Cloudflare Durable Objects filesystem
 */

import type {
  CpOptions,
  FileContent,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../interface.js";

/**
 * Request types for communicating with the Durable Object
 */
export type DoFsRequest =
  | { type: "readFile"; path: string; options?: ReadFileOptions }
  | { type: "readFileBuffer"; path: string }
  | {
      type: "writeFile";
      path: string;
      content: FileContent;
      options?: WriteFileOptions;
    }
  | {
      type: "appendFile";
      path: string;
      content: FileContent;
      options?: WriteFileOptions;
    }
  | { type: "exists"; path: string }
  | { type: "stat"; path: string }
  | { type: "lstat"; path: string }
  | { type: "mkdir"; path: string; options?: MkdirOptions }
  | { type: "readdir"; path: string }
  | { type: "readdirWithFileTypes"; path: string }
  | { type: "rm"; path: string; options?: RmOptions }
  | { type: "cp"; src: string; dest: string; options?: CpOptions }
  | { type: "mv"; src: string; dest: string }
  | { type: "chmod"; path: string; mode: number }
  | { type: "symlink"; target: string; linkPath: string }
  | { type: "link"; existingPath: string; newPath: string }
  | { type: "readlink"; path: string }
  | { type: "resolvePath"; base: string; path: string }
  | { type: "getAllPaths" }
  | { type: "snapshot" }
  | { type: "restore"; snapshot: FsSnapshot };

/**
 * Response types from the Durable Object
 */
export type DoFsResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Serialized filesystem snapshot for persistence
 */
export interface FsSnapshot {
  version: number;
  entries: Record<string, SerializedFsEntry>;
  timestamp: string;
}

/**
 * Serialized filesystem entry (dates as ISO strings, binary as base64)
 */
export type SerializedFsEntry =
  | {
      type: "file";
      content: string; // base64 for binary, plain string for text
      isBase64: boolean;
      mode: number;
      mtime: string;
    }
  | {
      type: "directory";
      mode: number;
      mtime: string;
    }
  | {
      type: "symlink";
      target: string;
      mode: number;
      mtime: string;
    };

/**
 * Configuration for DO filesystem client
 */
export interface DoFsConfig {
  /**
   * Durable Object namespace binding
   */
  namespace: DurableObjectNamespace;

  /**
   * ID of the Durable Object to use for storage
   * If not provided, a new ID will be generated
   */
  objectId?: DurableObjectId | string;

  /**
   * Optional name for the Durable Object (for named objects)
   */
  objectName?: string;

  /**
   * Request timeout in milliseconds
   * @default 10000
   */
  timeout?: number;
}

/**
 * Durable Object state interface (minimal subset needed)
 */
export interface DoState {
  storage: DurableObjectStorage;
  id: DurableObjectId;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Durable Object Storage interface (minimal subset)
 */
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  put<T = unknown>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  list<T = unknown>(options?: {
    start?: string;
    end?: string;
    prefix?: string;
    reverse?: boolean;
    limit?: number;
  }): Promise<Map<string, T>>;
  deleteAll(): Promise<void>;
}

/**
 * Minimal DurableObjectId interface
 */
export interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
}

/**
 * Minimal DurableObjectNamespace interface
 */
export interface DurableObjectNamespace {
  newUniqueId(options?: { jurisdiction?: string }): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(hexId: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

/**
 * Minimal DurableObjectStub interface
 */
export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
  id: DurableObjectId;
}
