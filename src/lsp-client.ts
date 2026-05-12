/**
 * LSP Client - Low-level JSON-RPC communication with LSP servers
 * Uses stdio (stdin/stdout) to communicate with the language server process
 */

import * as child_process from "node:child_process";
import type {
  Location,
  Range,
  SymbolInformation,
  WorkspaceSymbol,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  WorkspaceEdit,
  Diagnostic,
} from "vscode-languageserver-types";
import type { LspServerConfig, LspServerInstance } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────

/** Default timeout for LSP requests (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Maximum message size to prevent memory exhaustion (10 MB) */
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB
/** Timeout for the initialize handshake (60 seconds) */
const INITIALIZE_TIMEOUT_MS = 60_000;
/** Timeout for graceful shutdown (5 seconds) */
const SHUTDOWN_TIMEOUT_MS = 5_000;
/** Timeout before force-killing after SIGTERM (3 seconds) */
const FORCE_KILL_DELAY_MS = 3_000;

// ── JSON-RPC Message Types ─────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ── LSP Protocol Types (minimal subset) ────────────────────────────────────

interface InitializeParams {
  processId: number | null;
  clientInfo?: { name: string; version?: string };
  rootUri: string | null;
  initializationOptions?: Record<string, unknown>;
  capabilities: {
    textDocument?: {
      synchronization?: { didSave?: boolean };
      completion?: { completionItem?: { snippetSupport?: boolean } };
      diagnostic?: { dynamicRegistration?: boolean };
    };
    workspace?: {
      workspaceFolders?: boolean;
      symbol?: { dynamicRegistration?: boolean };
    };
    window?: {
      workDoneProgress?: boolean;
    };
  };
}

interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

interface TextDocumentPositionParams {
  textDocument: { uri: string };
  position: { line: number; character: number };
}

interface DidChangeTextDocumentParams {
  textDocument: { uri: string; version: number };
  contentChanges: { text: string }[];
}

interface ReferenceParams extends TextDocumentPositionParams {
  context: { includeDeclaration: boolean };
}

interface RenameParams extends TextDocumentPositionParams {
  newName: string;
}

interface WorkspaceSymbolParams {
  query: string;
}

interface PrepareCallHierarchyParams {
  textDocument: { uri: string };
  position: { line: number; character: number };
}

interface CallHierarchyIncomingCallsParams {
  item: {
    name: string;
    kind: number;
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
    data?: unknown;
  };
}

interface CallHierarchyOutgoingCallsParams {
  item: {
    name: string;
    kind: number;
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
    data?: unknown;
  };
}

// ── LSP Client Class ───────────────────────────────────────────────────────

export class LspClient {
  private server: LspServerInstance;
  private process: child_process.ChildProcess | null = null;
  private buffer = "";
  private contentLength = -1;
  private onNotification?: (method: string, params: unknown) => void;

  constructor(server: LspServerInstance, onNotification?: (method: string, params: unknown) => void) {
    this.server = server;
    this.onNotification = onNotification;
  }

  /** Start the LSP server process */
  startProcess(config: LspServerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.process = child_process.spawn(config.command, config.args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...globalThis.process.env },
        });

        this.server.pid = this.process.pid ?? null;
        this.server.status = "starting";

        this.process.stdout?.on("data", (data: Buffer) => {
          this.handleData(data.toString());
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          // LSP servers often log info to stderr; ignore unless critical
          const msg = data.toString().trim();
          if (msg && !msg.startsWith("Content-Length")) {
            // Could log this if needed
          }
        });

        this.process.on("error", (err) => {
          this.server.status = "error";
          reject(new Error(`Failed to start LSP server "${config.language}": ${err.message}`));
        });

        this.process.on("exit", (code, signal) => {
          this.server.status = "stopped";
          this.server.pid = null;
          // Reject all pending requests
          for (const [id, pending] of this.server.pendingRequests) {
            pending.reject(new Error(`LSP server exited with code ${code}, signal ${signal}`));
            this.server.pendingRequests.delete(id);
          }
        });

        resolve();
      } catch (err) {
        this.server.status = "error";
        reject(err);
      }
    });
  }

  /** Parse incoming LSP data from stdout */
  private handleData(data: string): void {
    this.buffer += data;

    while (this.buffer.length > 0) {
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;

        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        if (this.contentLength > MAX_MESSAGE_SIZE || this.contentLength < 0) {
          this.buffer = "";
          this.contentLength = -1;
          return;
        }
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) break;

      const body = this.buffer.slice(0, this.contentLength);
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;

      try {
        const message = JSON.parse(body);
        this.handleMessage(message);
      } catch {
        // Skip malformed messages
      }
    }
  }

  /** Handle a parsed JSON-RPC message */
  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    if ("id" in message && typeof message.id === "number") {
      // Response to a request
      const pending = this.server.pendingRequests.get(message.id);
      if (pending) {
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
        this.server.pendingRequests.delete(message.id);
        if (pending.timer) clearTimeout(pending.timer);
      }
    } else if ("method" in message) {
      // Notification — forward to the manager
      if (this.onNotification) {
        this.onNotification(message.method, message.params);
      }
    }
  }

  /** Send a JSON-RPC message to the server */
  private sendMessage(message: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.process?.stdin) {
      throw new Error("LSP server process stdin not available");
    }
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  /** Send a request and wait for response */
  request<T = unknown>(method: string, params: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    const id = this.server.nextId++;
    this.server.lastActive = Date.now();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.server.pendingRequests.delete(id);
        reject(new Error(`LSP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.server.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.sendMessage({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.server.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /** Send a notification (no response expected) */
  notify(method: string, params: unknown): void {
    this.server.lastActive = Date.now();
    this.sendMessage({ jsonrpc: "2.0", method, params });
  }

  /** Initialize the LSP connection */
  async initialize(config: LspServerConfig, rootUri: string | null): Promise<void> {
    const params: InitializeParams = {
      processId: globalThis.process.pid,
      clientInfo: { name: "pi-lsp", version: "1.0.0" },
      rootUri,
      initializationOptions: config.initializationOptions,
      capabilities: {
        textDocument: {
          synchronization: { didSave: false },
          completion: { completionItem: { snippetSupport: false } },
          diagnostic: { dynamicRegistration: false },
        },
        workspace: {
          workspaceFolders: false,
          symbol: { dynamicRegistration: false },
        },
        window: { workDoneProgress: false },
      },
    };

    const result = await this.request<Record<string, unknown>>("initialize", params, INITIALIZE_TIMEOUT_MS);
    this.server.capabilities = result;
    this.server.initialized = false;

    // Send initialized notification
    this.notify("initialized", {});
    this.server.initialized = true;
    this.server.status = "running";
  }

  /** Open a text document */
  async didOpen(uri: string, languageId: string, version: number, text: string): Promise<void> {
    const item: TextDocumentItem = { uri, languageId, version, text };
    this.notify("textDocument/didOpen", { textDocument: item });
  }

  /** Notify document change */
  didChange(uri: string, version: number, text: string): void {
    const params: DidChangeTextDocumentParams = {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    };
    this.notify("textDocument/didChange", params);
  }

  /** Close a text document */
  didClose(uri: string): void {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  /** Request diagnostics via pull model (LSP 3.17+) */
  async requestDiagnostics(uri: string): Promise<Diagnostic[] | null> {
    return this.request<Diagnostic[] | null>("textDocument/diagnostic", { textDocument: { uri } }, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Go to definition */
  async gotoDefinition(uri: string, line: number, col: number): Promise<Location | Location[] | null> {
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position: { line, character: col },
    };
    return this.request<Location | Location[] | null>("textDocument/definition", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Find references */
  async findReferences(uri: string, line: number, col: number): Promise<Location[] | null> {
    const params: ReferenceParams = {
      textDocument: { uri },
      position: { line, character: col },
      context: { includeDeclaration: true },
    };
    return this.request<Location[] | null>("textDocument/references", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Prepare rename (returns valid rename range and placeholder) */
  async prepareRename(uri: string, line: number, col: number): Promise<Range | { range: Range; placeholder: string } | null> {
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position: { line, character: col },
    };
    return this.request<Range | { range: Range; placeholder: string } | null>("textDocument/prepareRename", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Rename symbol */
  async rename(uri: string, line: number, col: number, newName: string): Promise<WorkspaceEdit | null> {
    const params: RenameParams = {
      textDocument: { uri },
      position: { line, character: col },
      newName,
    };
    return this.request<WorkspaceEdit | null>("textDocument/rename", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Workspace symbol search */
  async workspaceSymbol(query: string): Promise<SymbolInformation[] | WorkspaceSymbol[] | null> {
    const params: WorkspaceSymbolParams = { query };
    return this.request<SymbolInformation[] | WorkspaceSymbol[] | null>("workspace/symbol", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Prepare call hierarchy */
  async prepareCallHierarchy(uri: string, line: number, col: number): Promise<CallHierarchyItem[] | null> {
    const params: PrepareCallHierarchyParams = {
      textDocument: { uri },
      position: { line, character: col },
    };
    return this.request<CallHierarchyItem[] | null>("textDocument/prepareCallHierarchy", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Get incoming calls */
  async incomingCalls(item: {
    name: string;
    kind: number;
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
    data?: unknown;
  }): Promise<CallHierarchyIncomingCall[] | null> {
    const params: CallHierarchyIncomingCallsParams = { item };
    return this.request<CallHierarchyIncomingCall[] | null>("callHierarchy/incomingCalls", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Get outgoing calls */
  async outgoingCalls(item: {
    name: string;
    kind: number;
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
    data?: unknown;
  }): Promise<CallHierarchyOutgoingCall[] | null> {
    const params: CallHierarchyOutgoingCallsParams = { item };
    return this.request<CallHierarchyOutgoingCall[] | null>("callHierarchy/outgoingCalls", params, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /** Shutdown the LSP server gracefully */
  async shutdown(): Promise<void> {
    if (this.server.status !== "running") return;
    this.server.status = "stopping";

    try {
      await this.request("shutdown", {}, SHUTDOWN_TIMEOUT_MS);
      this.notify("exit", {});
    } catch {
      // Force kill if graceful shutdown fails
      const proc = this.process;
      if (proc) {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, FORCE_KILL_DELAY_MS);
      }
    }

    this.server.status = "stopped";
    this.process = null;
    this.server.pid = null;
  }

  /** Force kill the server process */
  kill(): void {
    if (this.process) {
      this.process.kill("SIGKILL");
      this.process = null;
    }
    this.server.status = "stopped";
    this.server.pid = null;
  }

  /** Check if the process is still alive */
  isAlive(): boolean {
    if (!this.process) return false;
    return !this.process.killed;
  }
}
