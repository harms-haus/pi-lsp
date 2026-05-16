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

**Current status:** 284 passing across 18 test files.

### Coverage Thresholds

The project enforces minimum coverage thresholds in `vitest.config.ts`:

```ts
coverage: {
  provider: "v8",
  include: ["src/**/*.ts"],
  exclude: ["src/types-global.d.ts"],
  thresholds: {
    statements: 85,
    branches: 75,
    functions: 80,
    lines: 85,
  },
},
```

| Metric | Threshold |
|--------|-----------|
| Statements | 85% |
| Branches | 75% |
| Functions | 80% |
| Lines | 85% |

Run `npm run test:coverage` to check. The build fails if any threshold is not met.

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

**Important:** Because `spawn` is mocked globally, tests that need to exercise real process communication (like the LSP request/response lifecycle in `lsp-client.test.ts`) must use the `createClientWithMock()` helper instead of relying on `spawn`.

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

### `create-client-with-mock.ts` — LspClient Test Harness

Creates an `LspClient` wired to a fully-controllable mock child process. The harness intercepts `child_process.spawn` and returns a mock process that tests can drive programmatically:

```ts
export function createClientWithMock() → {
  client: LspClient,         // Real LspClient instance connected to mock
  config: LspServerConfig,   // Test server config (TypeScript)
  getSentMessages(),         // Returns all JSON messages written to stdin
  sendToClient(msg),         // Push a JSON-RPC message into client's handleData()
  autoRespond(),             // Auto-respond to initialize/shutdown
}
```

**Typical usage:**

```ts
const h = createClientWithMock();
h.autoRespond();
await h.client.startProcess(h.config);

// Inspect what the client sent
const messages = h.getSentMessages();
expect(messages[0].method).toBe("initialize");

// Simulate a server response
h.sendToClient({ jsonrpc: "2.0", id: 1, result: { /* ... */ } });
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

### `tests/unit/lsp-client-methods.test.ts` (29 tests, all passing)

Tests the high-level LSP method wrappers in `src/lsp-client-methods.js` using the `createClientWithMock()` harness:

| Describe Block | Methods Tested | Coverage |
|----------------|---------------|----------|
| Initialization | `initialize()`, `shutdown()` | Initialize with/without root URI, shutdown lifecycle |
| Document synchronization | `didOpen()`, `didChange()`, `didClose()` | Text document sync notifications |
| Language features | `gotoDefinition()`, `findReferences()`, `hover()`, `documentSymbol()`, `workspaceSymbol()`, `findImplementations()`, `findTypeDefinition()` | Request/response with mocked results |
| Rename | `prepareRename()`, `rename()` | Two-phase rename flow |
| Call hierarchy | `prepareCallHierarchy()`, `incomingCalls()`, `outgoingCalls()` | Call hierarchy navigation |
| Type hierarchy | `prepareTypeHierarchy()`, `supertypes()`, `subtypes()` | Type hierarchy navigation |
| Utilities | `ensureFileOpen()`, `getSemanticTokens()` | File tracking, token requests |

Each test starts a mock process, sends `initialize`, and verifies the correct JSON-RPC request is dispatched and the response is returned to the caller.

---

### `tests/unit/shared.test.ts` (102 tests, all passing)

Tests pure utility functions from `src/tools/shared.js` (which re-exports from `paths.ts`, `formatting.ts`, and `preamble.ts`):

| Describe Block | Functions Tested | Coverage |
|----------------|-----------------|----------|
| `applyEdits` | `applyEdits()` | Insert at start/middle/end, replace, delete, multi-line, multiple edits (reverse-order application), empty array |
| `buildDiff` | `buildDiff()` | Identical files ("no changes"), single-line changes, added/removed lines, multiple changes, diff at boundaries |
| `resolveFile` | `resolveFile()` | Absolute paths, relative paths, `..` and `.` segments, complex relative paths |
| `uriToFilePath` | `uriToFilePath()` | Standard `file://` URIs, URL-encoded characters (spaces, slashes), empty URIs, query strings |
| `filePathToUri` | `filePathToUri()` | Standard paths, special character encoding (spaces → `%20`) |

### `tests/unit/language-config.test.ts` (31 tests, 30 passing, 1 skipped)

Tests `src/language-config.js`:

| Describe Block | Functions Tested | Coverage |
|----------------|-----------------|----------|
| `languageFromPath` | `languageFromPath()` | 17 file extensions: `.ts`, `.tsx`, `.js`, `.py`, `.rs`, `.go`, `.c`, `.cpp`, `.h`, `.java`, `.rb`, `.lua`, `.html`, `.css`, `.json`, `.yaml`, `.yml`, `.md`. Also: unknown extensions, no-extension files, multi-dot filenames, Windows-style paths |
| `getConfigForExtension` | `getConfigForExtension()` | Returns full config for `.ts`/`.py`, `undefined` for unknown, verifies all 7 config fields are present |
| `isServerInstalled` | `isServerInstalled()` | Success case, failure case, thrown exception case, verifies correct `detectCommand` is called with 10s timeout. **Skipped:** timeout handling (requires async delay) |

### `tests/unit/lsp-client.test.ts` (17 tests, all passing)

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



### `tests/unit/lsp-manager.test.ts` (44 tests, all passing)

Tests the `LspManager` class — server lifecycle, client management, file tracking, and idle timeout:

| Describe Block | Coverage |
|----------------|----------|
| `getStatus()` | Returns empty array initially, shows running servers |
| `getClientForConfig()` | Creates clients, reuses existing, handles failures |
| `ensureFileOpen()` | Opens files, tracks versions, re-opens on version mismatch |
| `stopServer()` / `stopAll()` | Clean shutdown, removes client from map |
| `handleDiagnosticsNotification()` | Stores diagnostics, emits events |
| Idle timeout | Auto-stops after inactivity, resets on activity |

### `tests/unit/index.test.ts` (17 tests, all passing)

Tests the extension entry point (`src/index.js`) — tool and command registration, lifecycle hooks, and the `/lsp-status` command handler.

### `tests/unit/diagnostics.test.ts` (10 tests, all passing)

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

| File | Tool | Mocked Client Methods |
|------|------|----------------------|
| `tool-diagnostics.test.ts` | `lsp_diagnostics` | `getDiagnostics`, `ensureFileOpen` |
| `tool-find-references.test.ts` | `find_references` | `findReferences`, `ensureFileOpen` |
| `tool-find-definition.test.ts` | `find_definition` | `gotoDefinition`, `ensureFileOpen` |
| `tool-rename-symbol.test.ts` | `rename_symbol` | `prepareRename`, `rename`, `ensureFileOpen` |
| `tool-find-symbols.test.ts` | `find_symbols` | `workspaceSymbol` |
| `tool-find-calls.test.ts` | `find_calls` | `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`, `ensureFileOpen` |
| `tool-find-document-symbols.test.ts` | `find_document_symbols` | `documentSymbol`, `ensureFileOpen` |
| `tool-hover.test.ts` | `hover` | `hover`, `ensureFileOpen` |
| `tool-find-implementations.test.ts` | `find_implementations` | `findImplementations`, `ensureFileOpen` |
| `tool-find-type-definition.test.ts` | `find_type_definition` | `findTypeDefinition`, `ensureFileOpen` |
| `tool-find-type-hierarchy.test.ts` | `find_type_hierarchy` | `prepareTypeHierarchy`, `ensureFileOpen` |

The mock manager for most tools includes:

```ts
mockManager = {
  getClientForConfig: vi.fn().mockResolvedValue({ /* LspClient methods */ }),
  ensureFileOpen: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockReturnValue([]),
  getClientMap: vi.fn().mockReturnValue(new Map()),
});
```

`find_symbols` omits `ensureFileOpen` and `getStatus` since it operates on workspace-level symbol search rather than a specific file.

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
