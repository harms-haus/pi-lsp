# Testing

## Test Framework and Configuration

pi-lsp uses **Vitest 4.x** for all testing. Configuration lives in `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globals: true,
  },
});
```

Key settings:

| Setting | Value | Purpose |
|---------|-------|---------|
| `environment` | `"node"` | All tests run in a Node.js environment |
| `include` | `src/**/*.test.ts`, `tests/**/*.test.ts` | Tests can live alongside source (`src/`) or in the dedicated `tests/` directory |
| `setupFiles` | `tests/setup.ts` | Global mocking runs before every test file |
| `globals` | `true` | `describe`, `it`, `expect`, `vi`, etc. are globally available |

**Current status:** 96 passing, 7 skipped (103 total) across 11 test files.

The 7 skipped tests fall into two categories:
- **5 in `lsp-client.test.ts`** — require a full process mock integration (request/response lifecycle, timeouts). Currently blocked by the global `child_process` mock.
- **1 in `language-config.test.ts`** — `isServerInstalled` timeout handling, which requires async delay testing.
- **1 in `tool-diagnostics.test.ts`** — requires full integration with `languageFromPath` without timing out.

---

## Global Setup

`tests/setup.ts` applies a blanket mock for `node:child_process` across **all** tests:

```ts
import { vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(),
}));
```

This prevents any test from accidentally spawning a real LSP server process. Individual test files can selectively re-import and configure the mock using `vi.mocked(exec)` as demonstrated in `language-config.test.ts`.

**Important:** Because `spawn` is mocked globally, tests that need to exercise real process communication (like the LSP request/response lifecycle in `lsp-client.test.ts`) must use the `createMockLspServer()` helper instead of relying on `spawn`. Five tests in that file remain skipped until full process-mock integration is added.

---

## Test Helpers

Three helper modules provide the building blocks for all tests.

### `fixtures.ts` — Test Data Fixtures

Exports pre-built `LspServerConfig` objects and a factory for `LspServerInstance`:

```ts
// Pre-configured TypeScript and Python server configs
export const TEST_TS_CONFIG: LspServerConfig   // typescript-language-server
export const TEST_PY_CONFIG: LspServerConfig   // pylsp

// Factory — creates a stopped LspServerInstance with all fields defaulted
export function createTestServerInstance(config?: LspServerConfig): LspServerInstance
```

`createTestServerInstance()` returns an `LspServerInstance` with safe defaults:

| Field | Default |
|-------|---------|
| `status` | `"stopped"` |
| `pid` | `null` |
| `nextId` | `1` |
| `pendingRequests` | `new Map()` |
| `fileVersions` | `new Map()` |
| `diagnostics` | `new Map()` |
| `rootUri` | `null` |
| `initialized` | `false` |
| `capabilities` | `null` |

### `mock-lsp-server.ts` — Fake LSP Server Process

Creates an EventEmitter-based mock that simulates a real LSP server process communicating over stdio with Content-Length–delimited JSON-RPC messages:

```ts
export function createMockLspServer() → {
  mockProcess: ChildProcess,   // Fake process with stdin, stdout, stderr
  respond(id, result),         // Send a JSON-RPC response to stdout
  respondError(id, code, msg), // Send a JSON-RPC error response
  sendNotification(method, params), // Send a server→client notification
  getSentMessages(),           // Returns all JSON messages written to stdin
  stdoutEmitter,               // EventEmitter for manual control
  stderrEmitter,
}
```

**Auto-initialize:** When `stdin.write()` receives a message with `method === "initialize"`, the mock automatically responds with `{ capabilities: {} }`. This eliminates boilerplate in tests that initialize clients.

**Typical usage:**

```ts
const { mockProcess, respond, sendNotification, getSentMessages } = createMockLspServer();

// The mock is passed where a real ChildProcess would be
vi.mocked(spawn).mockReturnValue(mockProcess);

// Inspect what the client sent
const messages = getSentMessages();
expect(messages[0].method).toBe("initialize");

// Simulate the server sending a notification back
sendNotification("textDocument/publishDiagnostics", {
  uri: "file:///test.ts",
  diagnostics: [{ severity: 1, message: "Error" }],
});
```

### `mock-extension-api.ts` — Fake Pi Extension API

Captures all tool and command registrations so their `execute` functions can be invoked directly:

```ts
export function createMockExtensionApi() → {
  registerTool: vi.fn(),     // Captures tool definitions into .tools array
  registerCommand: vi.fn(),  // Captures commands into .commands map
  on: vi.fn(),               // Captures event handlers into .eventHandlers map
  tools: Tool[],             // Array of registered tool objects
  commands: Record<string, Function>,
  eventHandlers: Record<string, Function[]>,
}

// Find a registered tool by name
export function getTool(pi, name: string) → Tool | undefined
```

**Typical usage in integration tests:**

```ts
const pi = createMockExtensionApi();
registerSomeTool(pi as any, () => mockManager, () => "/test/cwd");

const tool = getTool(pi, "lsp_some_tool");
expect(tool.name).toBe("lsp_some_tool");

// Execute the tool directly
const result = await tool.execute("call-1", { file: "test.ts" }, ...);
```

---

## Unit Tests

### `tests/unit/shared.test.ts` (20 tests, all passing)

Tests pure utility functions from `src/tools/shared.js`:

| Describe Block | Functions Tested | Coverage |
|----------------|-----------------|----------|
| `applyEdits` | `applyEdits()` | Insert at start/middle/end, replace, delete, multi-line, multiple edits (reverse-order application), empty array |
| `buildDiff` | `buildDiff()` | Identical files ("no changes"), single-line changes, added/removed lines, multiple changes, diff at boundaries |
| `resolveFile` | `resolveFile()` | Absolute paths, relative paths, `..` and `.` segments, complex relative paths |
| `uriToFilePath` | `uriToFilePath()` | Standard `file://` URIs, URL-encoded characters (spaces, slashes), empty URIs, query strings |
| `filePathToUri` | `filePathToUri()` | Standard paths, special character encoding (spaces → `%20`) |

### `tests/unit/language-config.test.ts` (24 tests, 23 passing, 1 skipped)

Tests `src/language-config.js`:

| Describe Block | Functions Tested | Coverage |
|----------------|-----------------|----------|
| `languageFromPath` | `languageFromPath()` | 17 file extensions: `.ts`, `.tsx`, `.js`, `.py`, `.rs`, `.go`, `.c`, `.cpp`, `.h`, `.java`, `.rb`, `.lua`, `.html`, `.css`, `.json`, `.yaml`, `.yml`, `.md`. Also: unknown extensions, no-extension files, multi-dot filenames, Windows-style paths |
| `getConfigForExtension` | `getConfigForExtension()` | Returns full config for `.ts`/`.py`, `undefined` for unknown, verifies all 7 config fields are present |
| `isServerInstalled` | `isServerInstalled()` | Success case, failure case, thrown exception case, verifies correct `detectCommand` is called with 10s timeout. **Skipped:** timeout handling (requires async delay) |

### `tests/unit/lsp-client.test.ts` (11 tests, 6 passing, 5 skipped)

Tests JSON-RPC message parsing in `LspClient` by calling the private `handleData()` method directly via `(client as any).handleData(...)`:

| Test | What It Verifies |
|------|-----------------|
| Parse complete Content-Length message | Full message → `onNotification` callback invoked with correct method and params |
| Partial messages across data events | First half → no callback; second half → callback fires |
| Partial header | Header sent in two chunks → still parsed correctly |
| Multiple messages in one chunk | Two concatenated messages → callback fires twice in order |
| No callback registered | `new LspClient(server)` without `onNotification` → no throw on notification |
| Invalid message (no Content-Length) | Malformed input → no throw, no callback |
| Buffer partial body content | Header → partial body → rest of body → callback fires only when complete |

**Skipped (5):** request/response lifecycle, error responses, sending requests, sending notifications, timeout handling. These require a full process mock that connects `LspClient` to `createMockLspServer()`.

### `tests/unit/lsp-manager.test.ts` (8 tests, all passing)

Smoke tests for `LspManager` class API surface:

- Verifies `getStatus()` returns empty array initially
- Verifies existence and type of all public methods: `getClientMap`, `getDiagnostics`, `handleDiagnosticsNotification`, `stopServer`, `stopAll`
- Verifies `handleDiagnosticsNotification` can be called without throwing

Uses a 60-second idle timeout for deterministic cleanup in `afterEach` via `await manager.stopAll()`.

### `tests/unit/diagnostics.test.ts` (11 tests, all passing)

Tests `registerDiagnosticsHook()` from `src/diagnostics.js`, which registers `tool_result` and `turn_end` event handlers on the Pi API:

| Test | What It Verifies |
|------|-----------------|
| Register `tool_result` handler | `pi.on("tool_result", fn)` is called |
| Register `turn_end` handler | `pi.on("turn_end", fn)` is called |
| No other handlers | Exactly 2 `pi.on()` calls |
| Errors + warnings → aggregate status | `setStatus("pi-lint", "1 error, 2 warnings")` |
| Clean diagnostics → cleared status | `setStatus("pi-lint", "✓ clean")` |
| Multiple files → counts aggregated | Two files with separate diagnostics → combined counts |
| No modified files → no status | `turn_end` without prior `write` tool → `setStatus` not called |
| Errors only → correct format | `"2 errors"` (no warnings section) |
| Warnings only → correct format | `"1 warning"` (no errors section) |
| Per-file notify with pluralization | `"file.ts: 1 error, 1 warning"` with `"error"` level |

Uses `vi.useFakeTimers()` / `vi.runAllTimersAsync()` to control the async debounce behavior.

---

## Integration Tests

All integration tests follow the **same pattern**:

1. Create a mock Extension API via `createMockExtensionApi()`
2. Create a mock `LspManager` with vi-mocked methods
3. Call the tool's `register*Tool()` function
4. Assert the tool was registered with the correct name
5. Execute the tool with invalid input (unsupported file type or missing query) and verify error response

### Test Files

| File | Tool | Mocked Client Methods | Error Trigger |
|------|------|----------------------|---------------|
| `tool-diagnostics.test.ts` | `lsp_diagnostics` | `getDiagnostics`, `ensureFileOpen` | Unsupported extension (`.csv`) |
| `tool-find-references.test.ts` | `lsp_find_references` | `findReferences`, `ensureFileOpen` | Unsupported extension (`.csv`) |
| `tool-goto-definition.test.ts` | `lsp_goto_definition` | `gotoDefinition`, `ensureFileOpen` | Unsupported extension (`.csv`) |
| `tool-refactor-symbol.test.ts` | `lsp_refactor_symbol` | `prepareRename`, `rename` | Unsupported extension (`.csv`) |
| `tool-find-symbol.test.ts` | `lsp_find_symbol` | `workspaceSymbol` | Empty query (`""`) |
| `tool-call-hierarchy.test.ts` | `lsp_call_hierarchy` | `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls` | Unsupported extension (`.csv`) |

The mock manager for most tools includes:

```ts
mockManager = {
  getClientForConfig: vi.fn().mockResolvedValue({ /* LspClient methods */ }),
  ensureFileOpen: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockReturnValue([]),
  getClientMap: vi.fn().mockReturnValue(new Map()),
};
```

`lsp_find_symbol` omits `ensureFileOpen` and `getStatus` since it doesn't operate on a specific file.

---

## Writing New Tests — Patterns

### Pattern 1: Testing a Pure Utility Function

For stateless functions (like those in `shared.ts`), write straightforward `describe`/`it` blocks with various input/output pairs:

```ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../src/tools/shared.js";

describe("applyEdits", () => {
  it("should insert text at the start of a file", () => {
    const text = "line2\nline3";
    const edits = [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "line1\n",
    }];
    expect(applyEdits(text, edits)).toBe("line1\nline2\nline3");
  });
});
```

### Pattern 2: Testing LspClient JSON-RPC Parsing

Access private methods via `(client as any)` and use the `onNotification` callback to verify parsed output:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LspClient } from "../../src/lsp-client.js";
import { createTestServerInstance } from "../helpers/fixtures.js";

describe("LspClient message parsing", () => {
  let client: LspClient;
  let onNotification: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const server = createTestServerInstance();
    onNotification = vi.fn();
    client = new LspClient(server, onNotification);
  });

  it("should parse a complete Content-Length message", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///test.ts", diagnostics: [] },
    });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    (client as any).handleData(message);

    expect(onNotification).toHaveBeenCalledWith(
      "textDocument/publishDiagnostics",
      { uri: "file:///test.ts", diagnostics: [] },
    );
  });
});
```

### Pattern 3: Testing Diagnostics Hook with Fake Timers

Use `vi.useFakeTimers()` to control async debounce and verify status/notify calls:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerDiagnosticsHook } from "../../src/diagnostics.js";

describe("diagnostics hook", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("should publish aggregated error counts", async () => {
    const mockPi = {
      on: vi.fn((event, handler) => { handlers[event] = handler; }),
    };
    const mockManager = {
      onFileChanged: vi.fn().mockResolvedValue(undefined),
      getDiagnostics: vi.fn().mockResolvedValue([
        { severity: 1 }, // Error
        { severity: 2 }, // Warning
      ]),
    };
    const setStatus = vi.fn();
    const ctx = { cwd: "/test", hasUI: true, ui: { setStatus, notify: vi.fn() } };

    registerDiagnosticsHook(mockPi as any, mockManager as any);

    // Trigger a file write
    await handlers["tool_result"](
      { toolName: "write", input: { path: "/test/file.ts" } },
      ctx,
    );

    // Flush debounce timers
    const turnEndPromise = handlers["turn_end"]({}, ctx);
    await vi.runAllTimersAsync();
    await turnEndPromise;

    expect(setStatus).toHaveBeenCalledWith("pi-lint", "1 error, 1 warning");
  });
});
```

### Pattern 4: Testing Tool Integration

Register the tool, verify its metadata, then execute with invalid input to confirm error handling:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerMyTool } from "../../src/tools/my-tool.js";

describe("lsp_my_tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        myMethod: vi.fn().mockResolvedValue([]),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerMyTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "lsp_my_tool");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("lsp_my_tool");
  });

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "lsp_my_tool");
    const result = await tool.execute(
      "call-1",
      { file: "data.csv" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
  });
});
```

---

## Running Tests

```bash
# Run all tests once
npm test

# Run in watch mode (re-runs on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage
```

Vitest also supports standard CLI filters:

```bash
# Run a specific test file
npx vitest run tests/unit/shared.test.ts

# Run tests matching a pattern
npx vitest run -t "applyEdits"

# Run only integration tests
npx vitest run tests/integration/

# Run with verbose output
npx vitest run --reporter=verbose
```
