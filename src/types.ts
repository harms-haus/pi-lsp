/**
 * Shared types for the pi-lsp extension
 */

import type {
  Diagnostic,
} from "vscode-languageserver-types";

// ── LSP Server Config ──────────────────────────────────────────────────────

export interface LspServerConfig {
  /** Language name (e.g. "typescript", "python") */
  language: string;
  /** Command to start the LSP server (argv[0]) */
  command: string;
  /** Additional args for the server command */
  args: string[];
  /** File extensions this server handles (with dot, e.g. ".ts") */
  extensions: string[];
  /** Initialization options sent during initialize */
  initializationOptions?: Record<string, unknown>;
  /** How to detect if the server is already installed */
  detectCommand: string;
  /** Human-readable install instructions */
  installInstructions: string;
  /** Package manager command to install the server */
  installCommand: string;
}

// ── Server State ────────────────────────────────────────────────────────────

export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface LspServerInstance {
  config: LspServerConfig;
  status: ServerStatus;
  /** Child process PID */
  pid: number | null;
  /** JSON-RPC message ID counter */
  nextId: number;
  /** Pending requests: id → resolve/reject */
  pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer?: NodeJS.Timeout }>;
  /** Last activity timestamp (ms) */
  lastActive: number;
  /** File versions for didChange tracking: uri → version */
  fileVersions: Map<string, number>;
  /** Diagnostics cache: uri → Diagnostic[] */
  diagnostics: Map<string, Diagnostic[]>;
  /** Root URI for this server instance */
  rootUri: string | null;
  /** Whether initialize has completed */
  initialized: boolean;
  /** Promise that resolves when initialization completes */
  initPromise: Promise<void> | null;
  /** Server capabilities after initialize */
  capabilities: Record<string, unknown> | null;
}

// ── Manager State ───────────────────────────────────────────────────────────

export interface LspManagerState {
  /** Active server instances keyed by language */
  servers: Map<string, LspServerInstance>;
  /** Idle timeout in ms (default 5 min) */
  idleTimeoutMs: number;
  /** Interval timer for checking idle servers */
  idleCheckInterval: NodeJS.Timeout | null;
  /** Current working directory */
  cwd: string;
  /** Request timeout in ms */
  requestTimeoutMs: number;
}

// ── Tool Parameters (exported for use in extension) ─────────────────────────

export interface LspDiagnosticsParams {
  file?: string;
  workspace?: boolean;
  refresh?: boolean;
}

export interface LspFindReferencesParams {
  file: string;
  line: number;
  column: number;
}

export interface LspRefactorSymbolParams {
  file: string;
  line: number;
  column: number;
  newName: string;
}

export interface LspGotoDefinitionParams {
  file: string;
  line: number;
  column: number;
}

export interface LspFindSymbolParams {
  query: string;
  kind?: string;
}

export interface LspCallHierarchyParams {
  file: string;
  line: number;
  column: number;
}

// ── New Tool Parameter Interfaces ──────────────────────────────────────────

export interface FindDocumentSymbolsParams {
  file: string;
}

export interface HoverParams {
  file: string;
  line: number;
  column: number;
}

export interface FindImplementationsParams {
  file: string;
  line: number;
  column: number;
}

export interface FindTypeDefinitionParams {
  file: string;
  line: number;
  column: number;
}

export interface FindTypeHierarchyParams {
  file: string;
  line: number;
  column: number;
  direction: "supertypes" | "subtypes";
  depth: number;
}

// ── Backward-compatible type aliases (preferred names for new tools) ────────

export type FindReferencesParams = LspFindReferencesParams;
export type RenameSymbolParams = LspRefactorSymbolParams;
export type FindDefinitionParams = LspGotoDefinitionParams;
export type FindSymbolsParams = LspFindSymbolParams;
export type FindCallsParams = LspCallHierarchyParams;
