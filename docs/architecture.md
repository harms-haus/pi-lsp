# pi-lsp Architecture

## 1. Overview

pi-lsp is a pi extension that integrates the Language Server Protocol (LSP) into the pi coding agent, providing language-aware tools (diagnostics, find-references, goto-definition, refactoring, symbol search, and call hierarchy) across 33+ languages. It manages persistent LSP server processes per language with idle timeout, communicates via JSON-RPC over stdio, and hooks into pi's event lifecycle for automatic diagnostics on file edits.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            pi Extension Host                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        index.ts (entry)                             │    │
│  │                                                                     │    │
│  │  session_start ──► initManager() ──► new LspManager(cwd, 5min)     │    │
│  │  session_shutdown ──► manager.stopAll()                             │    │
│  │  tool_result ──► publishLspStatus() (see §4)                        │    │
│  │  registerCommand "lsp-status"                                       │    │
│  │                                                                     │    │
│  │  registerDiagnosticsTool(pi, getManager, getCwd)                    │    │
│  │  registerFindReferencesTool(pi, getManager, getCwd)                 │    │
│  │  registerRefactorSymbolTool(pi, getManager, getCwd)                 │    │
│  │  registerGotoDefinitionTool(pi, getManager, getCwd)                 │    │
│  │  registerFindSymbolTool(pi, getManager, getCwd)                     │    │
│  │  registerCallHierarchyTool(pi, getManager, getCwd)                  │    │
│  └──────────┬──────────────────────────────────────────────────────────┘    │
│             │ registers 6 tools + command                                   │
│             ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       diagnostics.ts (hook)                         │    │
│  │                                                                     │    │
│  │  pi.on("tool_result") ◄── write/edit detected ── track modifiedFiles│    │
  │  ⚠ SEPARATE tool_result handler (see §4)                            │    │
  │     (index.ts: publishLspStatus; diagnostics.ts: track modifiedFiles)│    │
│  │  pi.on("turn_end")   ◄── onFileChanged() ──► getDiagnostics() ─┐   │    │
│  │                             notify pi-lint status via ctx.ui    │   │    │
│  └─────────────────────────────────────────────────────────────────┼───┘    │
│                                                                   │        │
│             ┌─────────────────────────────────────────────────────┘        │
│             ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        lsp-manager.ts                               │    │
│  │                                                                     │    │
│  │  state.servers : Map<language, LspServerInstance>                   │    │
│  │  clientMap     : Map<language, LspClient>                           │    │
│  │                                                                     │    │
│  │  getClientForFile(path) ──► languageFromPath() ──► getClientForConfig()│ │
│  │  startServer(config) ──► new LspClient() ──► startProcess() ──► initialize()│
│  │  ensureFileOpen() ──► didOpen() / didChange()                       │    │
│  │  getDiagnostics() ──► pull model OR cached push model               │    │
│  │  checkIdleServers() ◄── setInterval(60s) ── stop if idle > 5min     │    │
│  └──────────┬──────────────────────────────────────────────────────────┘    │
│             │                                                               │
│             ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        lsp-client.ts                                │    │
│  │                                                                     │    │
│  │  child_process.spawn(cmd, args) ──► stdio: [pipe, pipe, pipe]       │    │
│  │  stdout stream ──► handleData() ──► parse headers + JSON body       │    │
│  │  stdin ──► sendMessage() ──► Content-Length header + JSON body      │    │
│  │  request(id, method, params) ──► pendingRequests.set(id, promise)   │    │
│  │  handleMessage() ──► resolve/reject pending OR forward notification │    │
│  │  shutdown() ──► "shutdown" request ──► "exit" notification           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│             ▲                                                               │
│             │ sends LSP requests                                            │
│  ┌──────────┴──────────────────────────────────────────────────────────┐    │
│  │                    src/tools/ (6 tool modules)                      │    │
│  │                                                                     │    │
│  │  shared.ts ── executePreamble() (5/6 tools)                         │    │
│  │             ├── resolveFile() ──► languageFromPath()                │    │
│  │             ├── ensureServerInstalled() ──► isServerInstalled()     │    │
│  │             ├── manager.getClientForConfig()                        │    │
│  │             └── manager.ensureFileOpen()                            │    │
│  │                                                                     │    │
│  │  diagnostics.ts ── manager.getDiagnostics() ──► format summary      │    │
│  │  find-references.ts ── client.findReferences() ──► 1→0 index conv   │    │
│  │  goto-definition.ts ── client.gotoDefinition() ──► 1→0 index conv   │    │
│  │  refactor-symbol.ts ── client.prepareRename() + rename() ──► patch  │    │
│  │  find-symbol.ts ── client.workspaceSymbol() (special: no preamble)  │    │
│  │  call-hierarchy.ts ── prepareCallHierarchy() + incoming/outgoing    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│             ┌─────────────────────────────────────────────────────┐         │
│             │               language-config.ts                    │         │
│             │                                                     │         │
│             │  LANGUAGE_SERVERS[33] : LspServerConfig[]           │         │
│             │  languageFromPath(filePath) ──► ext → config        │         │
│             │  isServerInstalled(config) ──► exec detectCommand   │         │
│             └─────────────────────────────────────────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Data flows:
  ──►  synchronous call / await
  ──►  event registration (pi.on)
  ──►  JSON-RPC message (request/response/notification)
  ──►  process stdio communication
```

---

## 2. Module Map

| File | Responsibility | Public Exports | Imports From |
|---|---|---|---|
| `src/index.ts` | Extension entry point; lifecycle hooks, tool registration, status publishing | `default` function `(pi: ExtensionAPI) => void` | `./lsp-manager.js`, `./diagnostics.js`, `./tools/*.js` |
| `src/lsp-manager.ts` | Server lifecycle: start/stop/idle, file tracking, diagnostics cache | `LspManager` class | `./lsp-client.js`, `./language-config.js`, `./types.js` |
| `src/lsp-client.ts` | JSON-RPC protocol layer: stdio framing, message parsing, request tracking | `LspClient` class | `./types.js` |
| `src/types.ts` | Shared type definitions: configs, state, tool params | `LspServerConfig`, `ServerStatus`, `LspServerInstance`, `LspManagerState`, all `*Params` interfaces | `vscode-languageserver-types` (Diagnostic) |
| `src/types-global.d.ts` | Ambient type declarations for pi runtime & TypeBox | Module augmentations for `typebox` and `@earendil-works/pi-coding-agent` | — (declaration only) |
| `src/language-config.ts` | 33 language server configs; extension→language mapping; install detection | `LANGUAGE_SERVERS`, `getConfigForExtension()`, `languageFromPath()`, `isServerInstalled()` | `./types.js` |
| `src/diagnostics.ts` | Auto-trigger diagnostics hook on write/edit tool results | `registerDiagnosticsHook(pi, manager)` | `./lsp-manager.js`, `./language-config.js` |
| `src/tools/shared.ts` | Shared utilities: preamble, error builder, URI conversion, diff generation, constants | `executePreamble()`, `toolError()`, `resolveFile()`, `uriToFilePath()`, `filePathToUri()`, `ensureServerInstalled()`, `applyEdits()`, `buildDiff()`, `MAX_SYMBOL_RESULTS` (= 50), `SEVERITY_NAMES`, `SYMBOL_KIND_NAMES`, `ToolUI`, `PreambleResult` | `../lsp-manager.js`, `../lsp-client.js`, `../language-config.js`, `../types.js` |
| `src/tools/diagnostics.ts` | `lsp_diagnostics` tool registration | `registerDiagnosticsTool(pi, getManager, getCwd)` | `./shared.js` |
| `src/tools/find-references.ts` | `lsp_find_references` tool registration | `registerFindReferencesTool(pi, getManager, getCwd)` | `./shared.js` |
| `src/tools/goto-definition.ts` | `lsp_goto_definition` tool registration | `registerGotoDefinitionTool(pi, getManager, getCwd)` | `./shared.js` |
| `src/tools/refactor-symbol.ts` | `lsp_refactor_symbol` tool registration | `registerRefactorSymbolTool(pi, getManager, getCwd)` | `./shared.js` |
| `src/tools/find-symbol.ts` | `lsp_find_symbol` tool registration (workspace-wide search) | `registerFindSymbolTool(pi, getManager, getCwd)` | `./shared.js`, `../language-config.js` |
| `src/tools/call-hierarchy.ts` | `lsp_call_hierarchy` tool registration | `registerCallHierarchyTool(pi, getManager, getCwd)` | `./shared.js` |

---

## 3. Dependency Graph

```
index.ts
  ├── lsp-manager.ts
  │     ├── lsp-client.ts
  │     │     └── types.ts
  │     ├── language-config.ts
  │     │     └── types.ts
  │     └── types.ts
  ├── diagnostics.ts
  │     ├── lsp-manager.ts  (→ see above)
  │     └── language-config.ts  (→ see above)
  ├── tools/diagnostics.ts
  │     └── tools/shared.ts
  │           ├── lsp-manager.ts  (→ see above)
  │           ├── lsp-client.ts   (→ see above)
  │           └── language-config.ts  (→ see above)
  ├── tools/find-references.ts  ──► tools/shared.ts  (→ see above)
  ├── tools/goto-definition.ts  ──► tools/shared.ts  (→ see above)
  ├── tools/refactor-symbol.ts  ──► tools/shared.ts  (→ see above)
  ├── tools/find-symbol.ts      ──► tools/shared.ts + language-config.ts
  └── tools/call-hierarchy.ts   ──► tools/shared.ts  (→ see above)
```

**Import characteristics:**
- **`index.ts`** is the sole entry point. It imports all tool modules and the manager but never imports `lsp-client.ts` or `language-config.ts` directly.
- **`lsp-manager.ts`** is the central orchestrator. It imports `LspClient` and `languageFromPath`, and owns the `state.servers` and `clientMap` maps.
- **`lsp-client.ts`** is a leaf module — it only imports `types.ts` and `node:child_process`.
- **`tools/shared.ts`** is the shared utility layer. Every file-based tool imports it. It imports from the manager, client, and language-config layers.
- **`tools/find-symbol.ts`** is the only tool that bypasses `executePreamble()` and imports directly from `language-config.ts` for its workspace-scanning logic.

---

## 4. Session Lifecycle

```
pi loads extension
  │
  ▼
index.ts: default function(pi) is called
  │  ├─ Declares manager: LspManager | null = null
  │  ├─ Declares cwd = process.cwd()
  │  ├─ Registers 6 tools (pi.registerTool) — available immediately
  │  └─ Registers 1 command (pi.registerCommand "lsp-status")
  │
  ▼
session_start event fires
  │  ├─ cwd = ctx.cwd
  │  ├─ currentCtx = ctx
  │  ├─ initManager() ──► new LspManager(cwd, 5*60*1000)
  │  │     ├─ state.servers = new Map()
  │  │     ├─ clientMap = new Map()
  │  │     ├─ setInterval(checkIdleServers, 60_000)
  │  │     └─ registerDiagnosticsHook(pi, manager)
  │  │           ├─ pi.on("tool_result") — tracks modifiedFiles (SEPARATE handler from index.ts's publishLspStatus)
  │  │           └─ pi.on("turn_end")    — runs diagnostics
  │  └─ publishLspStatus() — ui.setStatus("pi-lsp", undefined)
  │
  ▼
User/Agent calls an LSP tool (e.g., lsp_diagnostics)
  │  ├─ execute() receives params
  │  ├─ executePreamble() runs
  │  │     ├─ resolve file path
  │  │     ├─ languageFromPath() → config
  │  │     ├─ isServerInstalled() / ensureServerInstalled()
  │  │     ├─ manager.getClientForConfig(config)
  │  │     │     └─ startServer(config) if needed
  │  │     │           ├─ new LspClient()
  │  │     │           ├─ client.startProcess(config) — spawn child
  │  │     │           ├─ client.initialize(config, rootUri)
  │  │     │           │     ├─ "initialize" request → capabilities
  │  │     │           │     ├─ "initialized" notification
  │  │     │           │     └─ server.status = "running"
  │  │     │           └─ server.lastActive = Date.now()
  │  │     └─ manager.ensureFileOpen() — didOpen/didChange
  │  └─ Tool-specific LSP request (findReferences, gotoDefinition, etc.)
  │
  ▼
diagnostics.ts hook fires on write/edit tool_result
  │  └─ Modified file tracked in Set
  │
  ▼
turn_end event fires
  │  ├─ 500ms settle delay
  │  ├─ For each modified file:
  │  │     ├─ manager.onFileChanged() — didOpen/didChange
  │  │     ├─ 1000ms wait for server processing
  │  │     └─ manager.getDiagnostics(filePath, true) — pull/push
  │  └─ ui.setStatus("pi-lint", "✓ clean" | "N error(s), M warning(s)")
  │
  ▼
Idle checker fires every 60 seconds
  │  └─ If server.status === "running" AND pendingRequests.size === 0
  │     AND (now - lastActive) > 5min ──► stopServer()
  │
  ▼
session_shutdown event fires
  │  ├─ manager.stopAll()
  │  │     └─ Promise.all(stopServer(lang) for each lang)
  │  │           ├─ client.shutdown() — graceful "shutdown" + "exit"
  │  │           └─ clearInterval(idleCheckInterval)
  │  ├─ manager = null
  │  └─ ui.setStatus("pi-lsp", undefined); ui.setStatus("pi-lint", undefined)
```

---

## 5. Server Lifecycle State Machine

The `ServerStatus` type (`src/types.ts`) defines five states:

```
                    ┌──────────┐
                    │ stopped  │  ◄── initial state, after stop, or after exit
                    └────┬─────┘
                         │ startServer() called
                         ▼
                    ┌──────────┐
            ┌───────│ starting │
            │       └────┬─────┘
            │            │ initialize() succeeds
            │            ▼
            │       ┌──────────┐
            │       │ running  │  ◄── normal operational state
            │       └────┬─────┘
            │            │
            │            ├─ idle timeout (lastActive > 5min, no pending)
            │            ├─ stopServer() called explicitly
            │            ├─ process.exit event fires (crash/death)
            │            ▼
            │       ┌──────────┐
            │       │ stopping │  ◄── brief transitional state
            │       └────┬─────┘
            │            │ shutdown() completes or fails
            │            ▼
            │       ┌──────────┐
            │       │ stopped  │
            │       └──────────┘
            │
            │  startProcess() throws
            │  initialize() throws
            ▼
       ┌──────────┐
       │  error   │  ◄── unrecoverable for this instance
       └────┬─────┘
            │ next getClientForConfig() detects "error" status
            │ and calls startServer() again (fresh instance)
            ▼
       ┌──────────┐
       │ starting │  ◄── automatic retry
       └──────────┘
```

**Transition triggers:**

| From | To | Trigger |
|---|---|---|
| `stopped` | `starting` | `startServer(config)` called via `getClientForConfig()` |
| `starting` | `running` | `initialize()` completes successfully (after `initialized` notification) |
| `starting` | `error` | `startProcess()` or `initialize()` throws |
| `running` | `stopping` | `shutdown()` called (via `stopServer()` or `stopAll()`) |
| `running` | `stopped` | Idle timeout cleanup; `process` exit event; force kill |
| `running` | `error` | `process` error event during initialization (rare, caught in try/catch) |
| `stopping` | `stopped` | `shutdown()` completes (graceful or force-kill fallback) |
| `error` | `starting` | Next `getClientForConfig()` call — `startServer()` cleans up and retries |
| `stopped` | `starting` | Same — `startServer()` is idempotent for stopped state |

---

## 6. LspManager Internals

### Data Structures

```typescript
// In lsp-manager.ts constructor
this.state = {
  servers: new Map(),       // Map<language, LspServerInstance>
  idleTimeoutMs: 300000,    // 5 minutes (configurable)
  idleCheckInterval: null,  // NodeJS.Timeout, set via setInterval
  cwd: "/path/to/workspace",
  requestTimeoutMs: 30000,  // 30 seconds per LSP request
};

this.clientMap = new Map(); // Map<language, LspClient>
```

### `LspServerInstance` per entry (from `types.ts`)

```typescript
interface LspServerInstance {
  config: LspServerConfig;          // Language server definition
  status: ServerStatus;             // Current lifecycle state
  pid: number | null;               // Child process PID
  nextId: number;                   // JSON-RPC message ID counter (starts at 1)
  pendingRequests: Map<number, { resolve, reject, timer? }>;
  lastActive: number;               // Date.now() timestamp
  fileVersions: Map<string, number>; // uri → version counter (for didChange)
  diagnostics: Map<string, Diagnostic[]>; // uri → cached diagnostics
  rootUri: string | null;           // file:// URI of workspace root
  initialized: boolean;             // Has initialize handshake completed?
  initPromise: Promise<void> | null; // UNUSED / dead code — always set to null in startServer(), no consumer reads it
  capabilities: Record<string, unknown> | null; // From initialize response
}
```

### Public Methods

#### `getStatus(): { language: string; status: string; pid: number | null }[]`

Returns an array of status objects for all managed servers. Each entry contains the language name, current `ServerStatus`, and child process PID (or `null` if not running). Used by:
- The `lsp-status` registered command (in `index.ts`) to display server health to the user.
- `publishLspStatus()` (in `index.ts`) to update `ui.setStatus("pi-lsp", ...)` with a formatted summary.

#### `getClientMap(): Map<string, LspClient>`

Returns the internal map of language → active `LspClient` instances. Used by:
- `lsp_find_symbol` (`src/tools/find-symbol.ts`) to iterate all running servers when performing workspace-wide symbol searches (bypasses `executePreamble()`).

### Idle Check Logic

```typescript
// Called every IDLE_CHECK_INTERVAL_MS (60_000ms)
private checkIdleServers(): void {
  const now = Date.now();
  for (const [language, server] of this.state.servers) {
    // Three conditions must ALL be true:
    // 1. Server is actively running (not stopping/error/stopped)
    // 2. No pending LSP requests (queue is empty)
    // 3. Time since last activity exceeds idle timeout
    if (
      server.status === "running" &&
      server.pendingRequests.size === 0 &&
      now - server.lastActive > this.state.idleTimeoutMs
    ) {
      this.stopServer(language); // graceful shutdown
    }
  }
}
```

**Key behaviors:**
- `lastActive` is updated on every request sent, response received, notification handled, and document change.
- The idle checker runs every 60 seconds independently of activity — a server that becomes idle just after a check will survive up to ~6 minutes (5min timeout + up to 60s until next check).
- Errors during idle cleanup are silently caught — a failing `stopServer()` won't crash the interval.

### File Tracking

Each server tracks open files in two maps:

| Map | Purpose | Update Trigger |
|---|---|---|
| `server.fileVersions: Map<uri, number>` | Monotonically increasing version counter per document | Incremented in `ensureFileOpen()` — first open sends `didOpen`, subsequent sends send `didChange` with incremented version |
| `server.diagnostics: Map<uri, Diagnostic[]>` | Cache of latest diagnostics per URI | Updated in `handleDiagnosticsNotification()` (push model) and `getDiagnostics()` (pull model) |

### Diagnostics Cache

The `server.diagnostics` map is populated by two paths:

1. **Push model** (default): LSP server sends `textDocument/publishDiagnostics` notification → `handleNotification()` → `handleDiagnosticsNotification()` → `server.diagnostics.set(uri, diagnostics)`.
2. **Pull model** (LSP 3.17+): `getDiagnostics()` calls `client.requestDiagnostics(uri)` → `textDocument/diagnostic` request → result stored in `server.diagnostics.set(uri, diags)`.

---

## 7. LspClient Protocol Layer

### JSON-RPC Framing

Communication uses the LSP standard stdio transport with `Content-Length` headers:

```
Outbound (stdin):
  ┌─────────────────────────────────┐
  │ Content-Length: 123\r\n         │  ← header
  │ \r\n                            │  ← header terminator
  │ {"jsonrpc":"2.0","id":1,...}    │  ← JSON body (123 bytes)
  └─────────────────────────────────┘

Inbound (stdout):
  ┌─────────────────────────────────┐
  │ Content-Length: 456\r\n         │
  │ \r\n                            │
  │ {"jsonrpc":"2.0","id":1,"result":...} │
  └─────────────────────────────────┘
```

### Message Parsing (`handleData`)

The parser is a streaming state machine:

```
State 1: contentLength === -1 (header scanning)
  │
  ├─ Append incoming data to internal buffer
  ├─ Search for "\r\n\r\n" (header terminator)
  │    └─ Not found → wait for more data
  ├─ Extract "Content-Length: N" via regex
  ├─ Validate: 0 <= N <= MAX_MESSAGE_SIZE (10 MB)
  │    └─ Invalid → reset buffer and contentLength
  └─ Advance buffer past header, set contentLength = N

State 2: contentLength >= 0 (body reading)
  │
  ├─ Check if buffer.length >= contentLength
  │    └─ Not enough → wait for more data
  ├─ Extract body = buffer.slice(0, contentLength)
  ├─ Advance buffer past body, reset contentLength = -1
  ├─ JSON.parse(body)
  │    └─ Malformed → skip
  └─ handleMessage(parsed)
```

### Request Tracking

```typescript
// In LspClient.request()
request<T>(method, params, timeoutMs = 30000): Promise<T> {
  const id = this.server.nextId++;       // Monotonic counter, starts at 1
  this.server.lastActive = Date.now();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {      // Per-request timeout
      this.server.pendingRequests.delete(id);
      reject(new Error(`LSP request "${method}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    this.server.pendingRequests.set(id, { resolve, reject, timer });
    this.sendMessage({ jsonrpc: "2.0", id, method, params });
  });
}
```

**Resolution paths:**
- **Success**: `handleMessage()` receives `{ id, result }` → `pending.resolve(result)` → clear timer, delete from map.
- **Error response**: `handleMessage()` receives `{ id, error: { code, message } }` → `pending.reject(new Error(message))`.
- **Timeout**: Timer fires → delete from map, reject with timeout error.
- **Process death**: `process.on("exit")` → reject all pending requests with exit code/signal.

### Process Management

| Method | Behavior |
|---|---|
| `startProcess(config)` | `child_process.spawn(cmd, args, { stdio: ["pipe","pipe","pipe"] })`. Inherits env from `globalThis.process.env`. Sets up stdout/stderr/exit/error handlers. Resolves immediately after spawn (initialization is separate). |
| `initialize(config, rootUri)` | Sends `initialize` request with client capabilities (60s timeout). Stores capabilities. Sends `initialized` notification. Sets `server.status = "running"`. |
| `shutdown()` | If status !== "running", returns immediately. Sets status to "stopping". Sends `shutdown` request (5s timeout), then `exit` notification. On failure, falls back to `proc.kill("SIGTERM")` → wait 3s → `proc.kill("SIGKILL")`. Sets status to "stopped". |
| `kill()` | Force `SIGKILL` immediately. Sets status to "stopped". |
| `isAlive()` | Returns `!process.killed`. False if process is null. |

### Shutdown Sequence

```
client.shutdown() called
  │
  ├─ server.status = "stopping"
  │
  ├─ try: request("shutdown", {}, 5000ms)
  │     └─ Server responds with null (LSP spec)
  │     └─ notify("exit", {}) — tells server to terminate
  │
  ├─ catch: graceful failed
  │     ├─ proc.kill("SIGTERM")
  │     └─ setTimeout(3000ms) → proc.kill("SIGKILL") if still alive
  │
  ├─ server.status = "stopped"
  ├─ process = null
  └─ server.pid = null
```

---

## 8. Tool Registration Pattern

Every tool follows the same closure-based registration pattern:

```typescript
// In index.ts
registerDiagnosticsTool(pi, getManager, getCwd);

// In tools/diagnostics.ts
export function registerDiagnosticsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,   // Lazy accessor (manager may not exist yet)
  getCwd: () => string,                  // Lazy accessor (cwd changes per session)
): void {
  pi.registerTool({
    name: "lsp_diagnostics",              // Tool identifier
    label: "LSP Diagnostics",             // Human-readable label
    description: "...",                   // Tool description for the agent
    promptSnippet: "...",                 // Shorthand for prompt injection
    promptGuidelines: [...],              // Usage guidelines for the agent
    parameters: Schema,                   // Typebox schema for validation
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Tool logic here
      return {
        content: [{ type: "text", text: "..." }],  // User-visible output
        details: { ... },                          // Structured metadata
      };
    },
  });
}
```

**Key design decisions:**
- **Lazy accessors** (`getManager`, `getCwd`) are passed as thunks, not values, because `manager` is `null` at registration time (created on `session_start`) and `cwd` changes per session.
- **Error shape**: Tools return `{ content: [{ type: "text", text: string }], details: {}, isError: true }` on failure. Success results omit `isError`.
- **`execute` signature**: `(toolCallId, params, signal, onUpdate, ctx) => Promise<ToolResult>`. `_toolCallId`, `_signal`, and `_onUpdate` are unused in most tools (prefixed with `_`).

### Result Shape

```typescript
// Success
{
  content: [{ type: "text", text: "Human-readable summary" }],
  details: { file: "...", count: N, ...structured data... },
  // isError: undefined (omitted)
}

// Error
{
  content: [{ type: "text", text: "Error message" }],
  details: { file: "...", ...context... },
  isError: true,
}
```

---

## 9. executePreamble Flow

Five of the six file-based tools (`lsp_diagnostics`, `lsp_find_references`, `lsp_goto_definition`, `lsp_refactor_symbol`, `lsp_call_hierarchy`) share a common preamble in `src/tools/shared.ts`. `lsp_find_symbol` is the exception — it operates workspace-wide and implements its own server discovery logic.

```
executePreamble(file, cwd, getManager, ui)
  │
  │  Step 1: Get manager
  ├─ manager = getManager()
  │  └─ null? → return { error: "LSP manager not initialized. Start a session first." }
  │
  │  Step 2: Resolve file path
  ├─ filePath = resolveFile(file, cwd)
  │  └─ absolute? return as-is : path.resolve(cwd, file)
  │
  │  Step 3: Detect language
  ├─ config = languageFromPath(filePath)
  │  └─ Extract extension via lastIndexOf("."), look up in LANGUAGE_SERVERS
  │  └─ undefined? → return { error: "No LSP server configured for ..." }
  │
  │  Step 4: Ensure server binary is installed
  ├─ installed = isServerInstalled(config)
  │  └─ exec(config.detectCommand, { timeout: 10s })
  │  └─ not installed?
  │        ├─ ui.confirm("Install LSP server: ...")
  │        │     └─ declined? → return { error: "LSP server not installed" }
  │        ├─ ui.notify("Installing ...")
  │        ├─ exec(config.installCommand, { timeout: 300s })
  │        │     └─ failed? → return { error: "Failed to install ..." }
  │        └─ isServerInstalled(config) — verify
  │              └─ failed? → return { error: "Installation verification failed" }
  │
  │  Step 5: Get or start LSP client
  ├─ client = manager.getClientForConfig(config)
  │  └─ Triggers startServer() if server is stopped/error/missing
  │  └─ null? → return { error: "Failed to start LSP server for ..." }
  │
  │  Step 6: Ensure file is open in LSP server
  ├─ uri = filePathToUri(filePath)
  ├─ manager.ensureFileOpen(client, config, filePath)
  │  └─ Reads file content from disk
  │  └─ First open? → client.didOpen(uri, langId, version, text)
  │  └─ Already open? → client.didChange(uri, version, text)
  │  └─ server.fileVersions.set(uri, newVersion)
  │
  └─ return { ok: { filePath, config, client, uri, manager } }
```

The preamble returns a discriminated union:

```typescript
// Success
{ ok: { filePath: string; config: LspServerConfig; client: LspClient; uri: string; manager: LspManager } }

// Failure
{ error: { content: [{ type: "text"; text: string }]; details: Record<string, unknown>; isError: true } }
```

---

## 10. Indexing Convention

pi-lsp tools use **1-indexed** line and column numbers in their public API, while the LSP protocol uses **0-indexed** values. Conversion happens at two boundaries:

### Tool API → LSP Wire (outbound)

```typescript
// In lsp_find_references.ts, lsp_goto_definition.ts, lsp_refactor_symbol.ts, lsp_call_hierarchy.ts
await client.findReferences(uri, params.line - 1, params.column - 1);
await client.gotoDefinition(uri, params.line - 1, params.column - 1);
await client.prepareRename(uri, params.line - 1, params.column - 1);
await client.prepareCallHierarchy(uri, params.line - 1, params.column - 1);
```

The `-1` conversion is applied inline at each call site.

### LSP Wire → Tool Result (inbound)

```typescript
// In lsp_find_references.ts
const locations = result.map((loc) => ({
  uri: loc.uri,
  line: loc.range.start.line + 1,       // 0-indexed → 1-indexed
  col: loc.range.start.character + 1,   // 0-indexed → 1-indexed
}));

// In lsp_diagnostics.ts
const startLine = d.range.start.line + 1;
const startCol = d.range.start.character + 1;
```

The `+1` conversion is applied when formatting results for display.

### Summary Table

| Boundary | Direction | Conversion | Applied In |
|---|---|---|---|
| Tool params → `client.*` | 1 → 0 | `line - 1`, `column - 1` | Each tool's `execute()` |
| LSP `Location` → tool result | 0 → 1 | `range.start.line + 1`, `character + 1` | Each tool's `execute()` |
| LSP `Diagnostic` → tool result | 0 → 1 | `range.start.line + 1`, `character + 1` | `lsp_diagnostics.ts` |
| Internal `applyEdits()` | 0-indexed | No conversion — works on raw LSP `TextEdit` ranges | `shared.ts` |

**Important**: The `applyEdits()` function in `shared.ts` operates on LSP-native 0-indexed ranges directly (from `WorkspaceEdit`), so no conversion is needed there.

---

## 11. Dual Diagnostics Model

pi-lsp supports both the traditional **push model** (LSP 3.16 and earlier) and the newer **pull model** (LSP 3.17+).

### Push Model (default, always available)

```
Server ──notification──► textDocument/publishDiagnostics
                              │
                              ▼
                     handleNotification() in LspManager
                              │
                              ▼
                     handleDiagnosticsNotification(language, uri, diagnostics)
                              │
                              ▼
                     server.diagnostics.set(uri, diagnostics)
                     server.lastActive = Date.now()
```

The server proactively pushes diagnostics whenever it finishes analyzing a file. These are cached in `server.diagnostics` and returned immediately on subsequent `getDiagnostics()` calls.

### Pull Model (LSP 3.17+, attempted first)

```
getDiagnostics(filePath, refresh=true)
  │
  ▼
client.requestDiagnostics(uri)
  │
  ├─ request("textDocument/diagnostic", { textDocument: { uri } })
  │
  └─ Response shape:
       {
         kind: "full" | "unchanged",
         resultId?: string,
         items?: Diagnostic[]    // Only present when kind === "full"
       }
```

### `getDiagnostics()` Decision Logic

```typescript
async getDiagnostics(filePath: string, refresh = false): Promise<Diagnostic[]> {
  // 1. Resolve language config, get client, ensure file is open
  //    (same preamble as tools, but without install prompt)

  // 2. Check if we need to refresh
  //    - refresh === true: always try pull model
  //    - server.diagnostics.get(uri)?.length === undefined: no cached data
  //    - !server.diagnostics.has(uri): URI not in cache
  if (refresh || server.diagnostics.get(uri)?.length === undefined || !server.diagnostics.has(uri)) {
    try {
      // 3. Try pull model first
      const result = await client.requestDiagnostics(uri);
      if (result && typeof result === "object" && "kind" in result && result.kind === "full") {
        const diags = result.items ?? [];
        server.diagnostics.set(uri, diags);
        return diags;
      }
    } catch {
      // 4. Pull model not supported or failed — fall through to cached
    }
  }

  // 5. Return cached diagnostics (from push notifications)
  return server.diagnostics.get(uri) ?? [];
}
```

**Behavioral notes:**
- When `refresh = false` and cached diagnostics exist, the cache is returned immediately without any network/server call.
- When `refresh = true`, the pull model is attempted first. If the server doesn't support `textDocument/diagnostic` (throws), the method falls back to cached push-model diagnostics.
- A successful pull response with `kind: "unchanged"` does not update the cache — the existing cached data remains valid.
- The `diagnostics.ts` hook always calls `getDiagnostics(filePath, true)` to force a fresh check after file modifications.

---

## Related Documentation

- [README](../README.md) — Project overview, installation, and usage
- [Supported Languages](./language-support.md) — Complete list of 33 language server configurations
