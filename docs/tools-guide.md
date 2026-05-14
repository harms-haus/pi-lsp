# Tool Implementation Guide

This document is a reference for contributors implementing or modifying LSP tool handlers in the pi-lsp extension. It covers the registration pattern, shared utilities, result formats, and per-tool implementation details.

## Table of Contents

- [Tool Registration Pattern](#tool-registration-pattern)
- [executePreamble — Shared Initialization](#executepreamble--shared-initialization)
- [Tool Result Format](#tool-result-format)
- [Per-Tool Implementation Details](#per-tool-implementation-details)
- [Shared Utilities](#shared-utilities)

---

## Tool Registration Pattern

Every tool is registered via a `registerXxxTool` function defined in its own module under `src/tools/`. The registration follows a consistent closure pattern:

```ts
export function registerDiagnosticsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({ /* ... */ });
}
```

### Why Closures

`getManager` and `getCwd` are **functions**, not values. The LSP manager is created lazily — it may not exist when the tool is registered, but it will exist when the tool executes. By passing closures, each tool captures a reference that is evaluated at execution time, not registration time. This avoids initialization-order problems.

| Parameter | Type | Purpose |
|-----------|------|---------|
| `pi` | `ExtensionAPI` | The pi-coding-agent extension API; used to call `pi.registerTool()` |
| `getManager` | `() => LspManager \| null` | Lazy accessor for the LSP manager singleton |
| `getCwd` | `() => string` | Lazy accessor for the current working directory |

### Schema Definition with TypeBox

Each tool declares its parameter schema using [@sinclair/typebox](https://github.com/sinclairzx81/typebox). The schema drives validation and is used to generate tool descriptions for the AI agent:

```ts
import { Type } from "typebox";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
  refresh: Type.Optional(Type.Boolean({ description: "Force refresh diagnostics" })),
});
```

### Metadata Fields

The object passed to `pi.registerTool()` contains these fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique tool identifier, e.g. `"lsp_diagnostics"` |
| `label` | `string` | Human-readable label shown in UI, e.g. `"LSP Diagnostics"` |
| `description` | `string` | One-line description of what the tool does |
| `promptSnippet` | `string` | Short snippet injected into system prompts |
| `promptGuidelines` | `string[]` | List of usage guidelines injected into system prompts |
| `parameters` | `TypeBox schema` | Validated parameter schema |
| `execute` | `async function` | The tool's execution logic |

### Execute Signature

```ts
async execute(
  _toolCallId: string,
  params: SchemaType,      // validated parameters matching the TypeBox schema
  _signal: AbortSignal,    // cancellation signal
  _onUpdate: (...args: unknown[]) => void,  // streaming update callback
  ctx: { ui: ToolUI },     // context with confirm/notify interface
): Promise<ToolResult>
```

---

## executePreamble — Shared Initialization

Five of the six tools share a common initialization sequence via `executePreamble` (from `src/tools/shared.ts`). This function handles the boilerplate that every file-based tool needs.

### Flow

1. **Get manager** — calls `getManager()`; returns error if `null`
2. **Resolve file path** — converts relative paths to absolute via `resolveFile(file, cwd)`
3. **Detect language** — calls `languageFromPath(filePath)` to find the matching `LspServerConfig`
4. **Check server installed** — if not installed, prompts user via `ensureServerInstalled()`
5. **Get or start client** — calls `manager.getClientForConfig(config)` to lazily start the LSP server
6. **Ensure file is open** — calls `manager.ensureFileOpen(client, config, filePath)` to send `textDocument/didOpen`
7. **Build URI** — converts file path to `file://` URI

### Return Type

```ts
// Success case
{ ok: PreambleResult }

interface PreambleResult {
  filePath: string;    // absolute file path
  config: LspServerConfig;  // detected server config
  client: LspClient;   // active LSP client
  uri: string;         // file:// URI
  manager: LspManager; // the manager instance
}

// Error case
{ error: {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  isError: true;
} }
```

### Usage Pattern

Every file-based tool starts its execute function the same way:

```ts
async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
  if ("error" in preamble) return preamble.error;

  const { client, uri, filePath, config, manager } = preamble.ok;
  // ... tool-specific logic
}
```

The `find_symbol` tool does **not** use the preamble because it is workspace-scoped (no single file to open) and has special server-selection logic.

---

## Tool Result Format

All tools return a result object conforming to the pi-coding-agent tool result interface.

### Success Result

```ts
{
  content: { type: "text"; text: string }[];  // always at least one text part
  details: Record<string, unknown>;            // structured data for programmatic use
  // Note: isError is absent or falsy on success
}
```

The `content` array is rendered as the human-readable response. The `details` object carries machine-parseable data (counts, arrays of locations, etc.) that the AI agent can reference in subsequent reasoning.

### Error Result

```ts
{
  content: [{ type: "text", text: "Human-readable error message" }],
  details: { /* contextual data like file, line, etc. */ },
  isError: true,
}
```

### toolError Helper

The `toolError(message, details?)` function from `shared.ts` constructs a standard error result:

```ts
import { toolError } from "./shared.js";

// Usage
return toolError("Failed to find definition: server returned null", { file: "src/index.ts" });
// Produces:
// {
//   content: [{ type: "text", text: "Failed to find definition: server returned null" }],
//   details: { file: "src/index.ts" },
//   isError: true,
// }
```

---

## Per-Tool Implementation Details

### lsp_diagnostics

**File:** `src/tools/diagnostics.ts`  
**Purpose:** Retrieve LSP diagnostics (errors, warnings, info messages) for a file.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the file to check |
| `refresh` | `boolean?` | If `true`, forces the server to re-analyze the file |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble |
| `textDocument/diagnostic` | request ↔ | LSP 3.17 pull-model diagnostics (30s timeout) |

**Core Logic:**

```ts
const diagnostics = await manager.getDiagnostics(filePath, params.refresh ?? false);
const errorCount = diagnostics.filter((d) => d.severity === 1).length;
const warningCount = diagnostics.filter((d) => d.severity === 2).length;
```

**Output Format:**

```
Diagnostics for src/index.ts (typescript):
2 error(s), 1 warning(s), 0 info message(s)

  Error: 10:5: [tsserver] Cannot find name 'foo' (2304)
  Warning: 25:1: [tsserver] 'x' is declared but never used (6133)
  Error: 42:12: [tsserver] Type 'string' is not assignable to type 'number' (2322)
```

**Special Behaviors:**
- Severity 1 = Error, 2 = Warning, 3 = Info, 4 = Hint (mapped via `SEVERITY_NAMES`)
- The `refresh` flag triggers a fresh `textDocument/diagnostic` request rather than returning cached diagnostics
- Diagnostics are cached on the `LspServerInstance` and updated via `publishDiagnostics` notifications from the server

---

### lsp_find_references

**File:** `src/tools/find-references.ts`  
**Purpose:** Find all locations where a symbol at the given position is referenced.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the file |
| `line` | `number` | Line number (1-indexed) |
| `column` | `number` | Column number (1-indexed) |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble |
| `textDocument/references` | request ↔ | `includeDeclaration: true` in params |

**Core Logic:**

```ts
const result = await client.findReferences(uri, params.line - 1, params.column - 1);
const locations = Array.isArray(result)
  ? result.map((loc) => ({
      uri: loc.uri,
      line: loc.range.start.line + 1,
      col: loc.range.start.character + 1,
    }))
  : [];
```

**Output Format:**

```
References found: 5

  /home/project/src/index.ts:10:5
  /home/project/src/utils.ts:23:12
  /home/project/src/utils.ts:45:8
  /home/project/src/types.ts:3:15
  /home/project/src/main.ts:1:1
```

**Special Behaviors:**
- Line and column are converted from 1-indexed (user-facing) to 0-indexed (LSP protocol) via `params.line - 1` and `params.column - 1`
- Results are always 0-indexed in LSP, converted back to 1-indexed for display
- Returns `(none)` if no references are found
- Both declarations and references are included (`includeDeclaration: true`)

---

### lsp_goto_definition

**File:** `src/tools/goto-definition.ts`  
**Purpose:** Find the definition location(s) of the symbol at the given position.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the file |
| `line` | `number` | Line number (1-indexed) |
| `column` | `number` | Column number (1-indexed) |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble |
| `textDocument/definition` | request ↔ | 30s timeout |

**Core Logic:**

```ts
const result = await client.gotoDefinition(uri, params.line - 1, params.column - 1);
let locations: { uri: string; line: number; col: number }[] = [];

if (Array.isArray(result)) {
  locations = result.map((loc) => ({
    uri: loc.uri,
    line: loc.range.start.line + 1,
    col: loc.range.start.character + 1,
  }));
} else if (result && typeof result === "object" && "uri" in result) {
  // Single Location (not wrapped in array)
  locations = [{ uri: result.uri, line: result.range.start.line + 1, col: result.range.start.character + 1 }];
}
```

**Output Format:**

```
Definition found: 1 location(s)

  /home/project/src/types.ts:15:10
```

**Special Behaviors:**
- Handles both `Location` (single object) and `Location[]` (array) return types from the LSP server
- Same 1-indexed → 0-indexed → 1-indexed conversion as `find_references`
- Returns `(none)` when the symbol has no definition (e.g., a builtin)

---

### lsp_refactor_symbol

**File:** `src/tools/refactor-symbol.ts`  
**Purpose:** Rename a symbol across the entire workspace. Returns a unified diff patch — does **not** apply changes automatically.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the file containing the symbol |
| `line` | `number` | Line number (1-indexed) |
| `column` | `number` | Column number (1-indexed) |
| `newName` | `string` | New name for the symbol |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble |
| `textDocument/prepareRename` | request ↔ | Gets the rename range and placeholder name |
| `textDocument/rename` | request ↔ | Returns a `WorkspaceEdit` with all changes |

**Core Logic:**

```ts
// Step 1: Try to determine the old symbol name
const prepareResult = await client.prepareRename(uri, params.line - 1, params.column - 1);

// Step 2: Request the rename
const workspaceEdit = await client.rename(uri, params.line - 1, params.column - 1, params.newName);

// Step 3: Build unified diff from WorkspaceEdit
const docChanges = workspaceEdit?.documentChanges ?? [];
for (const dc of docChanges) {
  if (typeof dc === "object" && "textDocument" in dc && "edits" in dc) {
    const textEdit = dc as TextDocumentEdit;
    const changePath = uriToFilePath(textEdit.textDocument.uri);
    const sorted = [...textEdit.edits].sort(/* reverse order */);
    const original = readFileSync(changePath, "utf-8");
    const modified = applyEdits(original, sorted);
    patchParts.push(buildDiff(changePath, original, modified));
  }
}
```

**Output Format:**

```
Rename "oldFunctionName" → "newFunctionName"
File: src/index.ts
Files affected: 3

Patch:
```diff
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,1 +10,1 @@
-  oldFunctionName();
+  newFunctionName();

--- a/src/utils.ts
+++ b/src/utils.ts
@@ -23,1 +23,1 @@
-export function oldFunctionName() {
+export function newFunctionName() {
```

Use the edit tool to apply these changes.
```

**Special Behaviors:**
- **Does not auto-apply** — returns a diff patch that the user/AI agent must apply separately via the edit tool
- Handles both `documentChanges` (LSP 3.17+) and legacy `changes` formats from `WorkspaceEdit`
- Uses a **three-tier fallback** to determine the old symbol name:
  1. `prepareRename` placeholder (if available)
  2. Extract text from file using the returned rename range
  3. Regex extraction of the word at cursor position (`/[\w$]+/`)
- Edits are sorted in reverse order (bottom-to-top, right-to-left) before applying to avoid offset corruption
- Falls back to a synthetic "new file" diff if the original file cannot be read

---

### lsp_find_symbol

**File:** `src/tools/find-symbol.ts`  
**Purpose:** Search for symbols (functions, classes, variables, etc.) across the entire workspace by fuzzy name match.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `query` | `string` | Fuzzy symbol name to search for |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `workspace/symbol` | request ↔ | 30s timeout; fuzzy match handled by server |

**Core Logic (server selection):**

```ts
// This tool does NOT use executePreamble. It selects a server differently:

// 1. Prefer TypeScript server (best workspace symbol support)
const tsConfig = LANGUAGE_SERVERS.find((c) => c.language === "typescript");
if (tsConfig) {
  client = await manager.getClientForConfig(tsConfig);
}

// 2. Fall back to any running server
if (!client) {
  for (const serverConfig of LANGUAGE_SERVERS) {
    const c = manager.getClientMap().get(serverConfig.language);
    if (c) { client = c; break; }
  }
}

// 3. Scan workspace for source files and start a matching server
if (!client) {
  const files = execFileSync("find", [cwd, "-maxdepth", "3", "-type", "f", /* extensions */]);
  // ... detect language from first found file, install if needed, start server
}

// 4. Perform the search
const result = await client.workspaceSymbol(params.query);
```

**Output Format:**

```
Symbols matching "UserModel": 12

  UserModel [models] (Class) — /home/project/src/models/user.ts:10
  createUser [services] (Function) — /home/project/src/services/user.ts:45
  IUserModel (Interface) — /home/project/src/types/user.ts:5
  ... and 9 more
```

**Special Behaviors:**
- **No preamble** — this is the only tool that does not use `executePreamble`, because it operates workspace-wide rather than on a single file
- Has its own **server selection strategy**: prefers TypeScript, falls back to any running server, then tries to start one by scanning the workspace
- Results capped at `MAX_SYMBOL_RESULTS` (50) in display output; the full count is shown
- Uses `SYMBOL_KIND_NAMES` to convert numeric LSP SymbolKind values to readable names
- The `details.symbols` array always contains the first 50 results with `name`, `kind`, `uri`, and `line`
- Query must be at least 1 character; returns an error for empty queries

---

### lsp_call_hierarchy

**File:** `src/tools/call-hierarchy.ts`  
**Purpose:** Show incoming calls (who calls this function) and outgoing calls (what this function calls) for a function/method.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the file |
| `line` | `number` | Line number (1-indexed) |
| `column` | `number` | Column number (1-indexed) |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble |
| `textDocument/prepareCallHierarchy` | request ↔ | Returns `CallHierarchyItem[]` for the position |
| `callHierarchy/incomingCalls` | request ↔ | Called on each item from prepare |
| `callHierarchy/outgoingCalls` | request ↔ | Called on each item from prepare |

**Core Logic:**

```ts
const prepareResult = await client.prepareCallHierarchy(uri, params.line - 1, params.column - 1);
const items = Array.isArray(prepareResult) ? prepareResult : (prepareResult ? [prepareResult] : []);

if (items.length === 0) {
  return { content: [{ type: "text", text: "No call hierarchy available..." }], details: { file: params.file } };
}

const item = items[0];  // use first match

let incomingCalls: any[] = [];
let outgoingCalls: any[] = [];

try {
  incomingCalls = await client.incomingCalls(item);
} catch { /* not supported by this server */ }

try {
  outgoingCalls = await client.outgoingCalls(item);
} catch { /* not supported by this server */ }
```

**Output Format:**

```
Call hierarchy for "processData" in src/index.ts:42:10

─── Incoming Calls (2) ───
  main — /home/project/src/main.ts:5
    at line 5
    at line 12

  runTests — /home/project/tests/index.ts:20
    at line 20

─── Outgoing Calls (3) ───
  validateInput — /home/project/src/utils.ts:15

  transform — /home/project/src/transform.ts:8

  saveToDb — /home/project/src/db.ts:30
```

**Special Behaviors:**
- Each call direction (`incomingCalls` / `outgoingCalls`) is wrapped in its own try/catch — some servers support one but not the other
- Uses the **first** `CallHierarchyItem` from `prepareCallHierarchy`; if multiple items are returned, only the first is analyzed
- `fromRanges` in incoming calls indicates the specific call site positions within the calling function
- Returns a "no call hierarchy" message (not an error) if the cursor is not on a callable symbol

---

## Shared Utilities

All shared helpers live in `src/tools/shared.ts`.

### Path Resolution

| Function | Signature | Description |
|----------|-----------|-------------|
| `resolveFile` | `(file: string, cwd: string) => string` | Converts relative paths to absolute. Passes through absolute paths unchanged. |
| `uriToFilePath` | `(uri: string) => string` | Strips `file://` prefix and decodes URI components. |
| `filePathToUri` | `(filePath: string) => string` | Converts an absolute file path to a `file://` URI using `pathToFileURL`. |

```ts
resolveFile("src/index.ts", "/home/project")  // → "/home/project/src/index.ts"
resolveFile("/home/project/src/index.ts", "/home/project")  // → "/home/project/src/index.ts" (unchanged)

uriToFilePath("file:///home/project/src/index.ts")  // → "/home/project/src/index.ts"
filePathToUri("/home/project/src/index.ts")  // → "file:///home/project/src/index.ts"
```

### Server Installation

```ts
async function ensureServerInstalled(language: string, ui: ToolUI): Promise<boolean>
```

Checks if the LSP server for `language` is installed. If not, prompts the user via `ui.confirm()`, runs the install command (with a 5-minute timeout), and verifies installation afterward. Returns `true` if the server is available (already installed or just installed), `false` otherwise.

### Text/Diff Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `applyEdits` | `(text: string, edits: TextEdit[]) => string` | Applies LSP TextEdits to source text. Sorts edits in reverse order to prevent offset corruption. Splits and rejoins lines correctly for multi-line edits. |
| `buildDiff` | `(filePath: string, original: string, modified: string) => string` | Produces a unified diff string in git-compatible format (`--- a/...` / `+++ b/...`). If no changes exist, outputs `@@ -0,0 +0,0 @@\n (no changes)`. |

### Constants

| Constant | Value | Used By |
|----------|-------|---------|
| `MAX_SYMBOL_RESULTS` | `50` | `find-symbol` — caps displayed results |
| `SEVERITY_NAMES` | `["?", "Error", "Warning", "Info", "Hint"]` | `diagnostics` — maps LSP severity numbers to names |
| `SYMBOL_KIND_NAMES` | `Record<number, string>` | `find-symbol` — maps LSP SymbolKind numbers to names (1=File through 26=TypeParameter) |

### ToolUI Interface

```ts
interface ToolUI {
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level: "info" | "warning" | "error" | "success"): void;
}
```

Provided via `ctx.ui` in the execute function. Used for interactive prompts (e.g., confirming server installation).
