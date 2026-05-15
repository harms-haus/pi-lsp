# Tool Implementation Guide

This document is a reference for contributors implementing or modifying LSP tool handlers in the pi-lsp extension. It covers the registration pattern, shared utilities, result formats, and per-tool implementation details.

## Table of Contents

- [Tool Registration Pattern](#tool-registration-pattern)
- [executePreamble — Shared Initialization](#executepreamble--shared-initialization)
- [Tool Result Format](#tool-result-format)
- [Per-Tool Implementation Details](#per-tool-implementation-details)
  - [lsp_diagnostics](#lsp_diagnostics)
  - [find_references](#find_references)
  - [find_definition](#find_definition)
  - [find_symbols](#find_symbols)
  - [find_calls](#find_calls)
  - [rename_symbol](#rename_symbol)
  - [find_document_symbols](#find_document_symbols)
  - [hover](#hover)
  - [find_implementations](#find_implementations)
  - [find_type_definition](#find_type_definition)
  - [find_type_hierarchy](#find_type_hierarchy)
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

Ten of the eleven tools share a common initialization sequence via `executePreamble` (from `src/tools/shared.ts`). This function handles the boilerplate that every file-based tool needs.

The exceptions are:
- **`find_symbols`** — operates workspace-wide with its own server selection strategy
- **`lsp_diagnostics` in workspace mode** — scans all open files across all servers instead of a single file

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
**Registration:** `registerDiagnosticsTool`  
**Purpose:** Retrieve LSP diagnostics (errors, warnings, info messages) for a file or scan the entire workspace.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string?` | Path to the file to check (required unless `workspace=true`) |
| `workspace` | `boolean?` | If `true`, scans all open files across all running LSP servers |
| `refresh` | `boolean?` | If `true`, forces the server to re-analyze the file |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble (file mode only) |
| `textDocument/diagnostic` | request ↔ | LSP 3.17 pull-model diagnostics (30s timeout) |

**Core Logic:**

```ts
// File mode
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
const diagnostics = await manager.getDiagnostics(filePath, params.refresh ?? false);

// Workspace mode (no preamble)
const allDiags = manager.getAllDiagnostics();
// Iterates over all URIs with diagnostics across all servers
```

**Output Format (file mode):**

```
Diagnostics for src/index.ts (typescript):
2 error(s), 1 warning(s), 0 info message(s)

  Error: 10:5: [tsserver] Cannot find name 'foo' (2304)
  Warning: 25:1: [tsserver] 'x' is declared but never used (6133)
  Error: 42:12: [tsserver] Type 'string' is not assignable to type 'number' (2322)
```

**Output Format (workspace mode):**

```
Workspace diagnostics:
3 file(s), 5 error(s), 2 warning(s), 1 info message(s)

/home/project/src/index.ts (2 error(s), 0 warning(s), 0 info):
  Error: 10:5: [tsserver] Cannot find name 'foo' (2304)
  Error: 42:12: [tsserver] Type 'string' is not assignable to type 'number' (2322)

/home/project/src/utils.ts (3 error(s), 2 warning(s), 1 info):
  ...
```

**Special Behaviors:**
- Severity 1 = Error, 2 = Warning, 3 = Info, 4 = Hint (mapped via `SEVERITY_NAMES`)
- The `refresh` flag triggers a fresh `textDocument/diagnostic` request rather than returning cached diagnostics
- Workspace mode uses `manager.getAllDiagnostics()` which returns cached diagnostics from `publishDiagnostics` notifications — it does not trigger re-analysis
- In workspace mode, neither `file` nor `executePreamble` is used
- If neither `file` nor `workspace=true` is provided, returns an error

---

### find_references

**File:** `src/tools/find_references.ts`  
**Registration:** `registerFindReferencesTool`  
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
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
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

### find_definition

**File:** `src/tools/find_definition.ts`  
**Registration:** `registerFindDefinitionTool`  
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
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
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

### find_symbols

**File:** `src/tools/find_symbols.ts`  
**Registration:** `registerFindSymbolsTool`  
**Purpose:** Search for symbols (functions, classes, variables, etc.) across the entire workspace by fuzzy name match, optionally filtered by symbol kind.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `query` | `string` | Fuzzy symbol name to search for |
| `kind` | `string?` | Filter by symbol kind (e.g. `"class"`, `"function"`, `"interface"`, `"enum"`). Case-insensitive. |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `workspace/symbol` | request ↔ | 30s timeout; fuzzy match handled by server |

**Core Logic (server selection):**

```ts
// This tool does NOT use executePreamble. It selects a server differently:

// 1. Prefer TypeScript server (best workspace symbol support)
const tsConfig = LANGUAGE_SERVERS.find((c) => c.language === "typescript");
if (tsConfig && await isServerInstalled(tsConfig)) {
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

// 4. Perform the search (with optional kind filtering)
const result = await client.workspaceSymbol(params.query);
if (params.kind) {
  const kindNum = parseSymbolKind(params.kind);
  if (kindNum !== undefined) {
    filtered = symbols.filter(s => s.kind === kindNum);
  }
}
```

**Output Format:**

```
Symbols matching "UserModel": 12

  UserModel [models] (Class) — /home/project/src/models/user.ts:10
  createUser [services] (Function) — /home/project/src/services/user.ts:45
  IUserModel (Interface) — /home/project/src/types/user.ts:5
  ... and 9 more
```

**With kind filter:**

```
Symbols matching "User" (kind: class): 3

  UserModel (Class) — /home/project/src/models/user.ts:10
  UserStore (Class) — /home/project/src/stores/user.ts:5
  UserFactory (Class) — /home/project/src/factory.ts:12
```

**Special Behaviors:**
- **No preamble** — operates workspace-wide with its own server selection strategy: prefers TypeScript, falls back to any running server, then tries to start one by scanning the workspace
- The `kind` parameter accepts either a number (e.g. `"5"`) or a name (e.g. `"class"`, `"Function"`). Parsing is handled by `parseSymbolKind` from `shared.ts`, which does a reverse lookup in `SYMBOL_KIND_BY_NAME`
- If an unrecognized `kind` string is provided, filtering is silently skipped and all results are returned
- Results capped at `MAX_SYMBOL_RESULTS` (50) in display output; the full count is shown
- Uses `SYMBOL_KIND_NAMES` to convert numeric LSP SymbolKind values to readable names
- Query must be at least 1 character; returns an error for empty queries

---

### find_calls

**File:** `src/tools/find_calls.ts`  
**Registration:** `registerFindCallsTool`  
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
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
const prepareResult = await client.prepareCallHierarchy(uri, params.line - 1, params.column - 1);
const items = Array.isArray(prepareResult) ? prepareResult : (prepareResult ? [prepareResult] : []);

if (items.length === 0) {
  return { content: [{ type: "text", text: "No call hierarchy available at this position..." }], details: { file: params.file } };
}

const item = items[0];  // use first match

let incomingCalls: any[] = [];
let outgoingCalls: any[] = [];

try {
  const incoming = await client.incomingCalls(item);
  incomingCalls = Array.isArray(incoming) ? incoming : [];
} catch { /* not supported by this server */ }

try {
  const outgoing = await client.outgoingCalls(item);
  outgoingCalls = Array.isArray(outgoing) ? outgoing : [];
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

### rename_symbol

**File:** `src/tools/rename_symbol.ts`  
**Registration:** `registerRenameSymbolTool`  
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
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);

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
+export function newFunctionName()
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
- Skips files outside the workspace root with a `"skipped"` note in the patch

---

### find_document_symbols

**File:** `src/tools/find_document_symbols.ts`  
**Registration:** `registerFindDocumentSymbolsTool`  
**Purpose:** Get a structured outline of all symbols (classes, functions, variables, etc.) defined in a single file. Useful for understanding file structure without reading the entire file.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the file to outline |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble |
| `textDocument/documentSymbol` | request ↔ | Returns `DocumentSymbol[]` or `SymbolInformation[]` |

**Core Logic:**

```ts
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
const result = await client.documentSymbol(uri);

// DocumentSymbol has children (hierarchical); SymbolInformation is flat
if ("children" in result[0]) {
  formatted = formatDocumentSymbols(result as DocumentSymbol[], "", flat);
} else {
  formatted = formatSymbolInformationList(result as SymbolInformation[], flat);
}
```

**Output Format:**

```
Document symbols for src/index.ts:
8 symbols found

Class App (line 5)
  Method constructor (line 6)
  Method initialize (line 12)
  Function main (line 30)
  Variable config (line 3)
  Interface AppConfig (line 40)
    Property port (line 41)
    Property debug (line 42)
```

**Special Behaviors:**
- Handles both `DocumentSymbol[]` (hierarchical, with `children` property) and `SymbolInformation[]` (flat) return types
- `DocumentSymbol` results are rendered with indentation to reflect the symbol tree
- `SymbolInformation` results are rendered as a flat list with 2-space indent
- Returns a "no symbols found" message if the server returns an empty result
- Only the `file` parameter is needed — no `line` or `column`

---

### hover

**File:** `src/tools/hover.ts`  
**Registration:** `registerHoverTool`  
**Purpose:** Get type information, function signatures, and documentation for the symbol at a given position. Equivalent to hovering over a symbol in an IDE.

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
| `textDocument/hover` | request ↔ | Returns `Hover` with type info, docs, and optional range |

**Core Logic:**

```ts
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
const result = await client.hover(uri, params.line - 1, params.column - 1);

if (!result) {
  return { content: [{ type: "text", text: "No hover information available at this position." }], ... };
}

const hoverContent = formatHoverContents(result.contents);
// formatHoverContents handles: string, MarkupContent, MarkedString, and MarkedString[]
```

**Output Format:**

```
Hover info at src/index.ts:10:5:

```typescript
function processData(input: string): Promise<Result>
```

Processes the input string and returns a Result object.

@param input - The string to process
@returns A Promise resolving to Result

Range: line 10:5 to line 10:18
```

**Special Behaviors:**
- The `formatHoverContents` helper normalizes three LSP content formats:
  - Plain `string` — returned as-is
  - `MarkupContent` (`{ kind, value }`) — returns the `value` field
  - `MarkedString` (`{ language, value }`) — wraps in a fenced code block
  - `MarkedString[]` — joins each entry with blank lines
- Returns "no hover information" (not an error) if the server returns `null`
- If the hover response includes a `range`, it is displayed as a 1-indexed line/column span
- Useful for quick type inspection without navigating to the definition

---

### find_implementations

**File:** `src/tools/find_implementations.ts`  
**Registration:** `registerFindImplementationsTool`  
**Purpose:** Find all concrete implementations of an interface, abstract class, or type at the given position.

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
| `textDocument/implementation` | request ↔ | Returns `Location[]` of implementations |

**Core Logic:**

```ts
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
const result = await client.findImplementations(uri, params.line - 1, params.column - 1);
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
Implementations found: 3

  /home/project/src/impl/sql-user-store.ts:10:1
  /home/project/src/impl/mock-user-store.ts:8:1
  /home/project/src/impl/redis-user-store.ts:15:1
```

**Special Behaviors:**
- Works best on interface/type definitions — place cursor on the type name itself
- Returns `(none)` if no implementations are found
- Same 1-indexed → 0-indexed → 1-indexed position conversion as other position-based tools
- Not all language servers support `textDocument/implementation` — returns empty results if unsupported

---

### find_type_definition

**File:** `src/tools/find_type_definition.ts`  
**Registration:** `registerFindTypeDefinitionTool`  
**Purpose:** Find where the **type** of a symbol is defined, as opposed to where the symbol itself is assigned. For example, on `const user: User`, `find_definition` goes to the variable assignment while `find_type_definition` goes to the `User` class or interface.

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
| `textDocument/typeDefinition` | request ↔ | Returns type definition locations |

**Core Logic:**

```ts
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
const result = await client.findTypeDefinition(uri, params.line - 1, params.column - 1);
let locations: { uri: string; line: number; col: number }[] = [];

if (Array.isArray(result)) {
  locations = result.map((loc) => ({
    uri: loc.uri,
    line: loc.range.start.line + 1,
    col: loc.range.start.character + 1,
  }));
} else if (result && typeof result === "object" && "uri" in result) {
  locations = [{ uri: result.uri, line: result.range.start.line + 1, col: result.range.start.character + 1 }];
}
```

**Output Format:**

```
Type definition found: 1 location(s)

  /home/project/src/types/user.ts:3:1
```

**Special Behaviors:**
- Handles both `Location` (single object) and `Location[]` (array) return types
- Complements `find_definition`: use `find_definition` to find where a variable is declared, use `find_type_definition` to find where its type is defined
- Returns `(none)` when the symbol has no type definition (e.g., `any`, `unknown`, or inferred primitives)

---

### find_type_hierarchy

**File:** `src/tools/find_type_hierarchy.ts`  
**Registration:** `registerFindTypeHierarchyTool`  
**Purpose:** Show the inheritance chain (parent types and/or child types) for a class or type at the given position.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the file |
| `line` | `number` | Line number (1-indexed) |
| `column` | `number` | Column number (1-indexed) |
| `direction` | `string?` | `"supertypes"` (parents), `"subtypes"` (children), or omitted for both. Default: both |
| `depth` | `number?` | Maximum depth to traverse. Default: 2 |

**LSP Methods Sent:**

| Method | Direction | Notes |
|--------|-----------|-------|
| `textDocument/didOpen` | notification → | Sent by preamble |
| `textDocument/prepareTypeHierarchy` | request ↔ | Returns `TypeHierarchyItem[]` for the position |
| `typeHierarchy/supertypes` | request ↔ | Returns parent types up to `depth` |
| `typeHierarchy/subtypes` | request ↔ | Returns child types up to `depth` |

**Core Logic:**

```ts
const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);

try {
  prepareResult = await client.prepareTypeHierarchy(uri, params.line - 1, params.column - 1);
} catch {
  return { content: [{ type: "text", text: "Type hierarchy is not supported..." }] };
}

const item = items[0];
const direction = params.direction ?? "both";

if (direction === "supertypes" || direction === "both") {
  supertypes = await client.typeHierarchySupertypes(item, params.depth ?? 2);
}
if (direction === "subtypes" || direction === "both") {
  subtypes = await client.typeHierarchySubtypes(item, params.depth ?? 2);
}
```

**Output Format:**

```
Type hierarchy for "UserService" in src/services/user.ts:10:1

─── Supertypes (2) ───
  ServiceInterface (Interface) — /home/project/src/interfaces/service.ts:5
  EventEmitter (Class) — /home/project/node_modules/events/events.d.ts:10

─── Subtypes (1) ───
  AdminUserService (Class) — /home/project/src/services/admin-user.ts:8
```

**Special Behaviors:**
- Each direction (`supertypes` / `subtypes`) is wrapped in its own try/catch — some servers support one but not the other
- If `prepareTypeHierarchy` throws (unsupported server), returns a clear "not supported" message — not an error
- Uses the **first** `TypeHierarchyItem` from the prepare result
- `depth` controls how many levels of the hierarchy to traverse; default is 2
- `direction` can be `"supertypes"` to see only the parent chain, `"subtypes"` for descendants, or omitted for both

---

## Shared Utilities

All shared helpers live in `src/tools/shared.ts`.

### Path Resolution

| Function | Signature | Description |
|----------|-----------|-------------|
| `resolveFile` | `(file: string, cwd: string) => string` | Converts relative paths to absolute. Validates that the resolved path is within the workspace to prevent path traversal. |
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

### Symbol Kind Parsing

| Function | Signature | Description |
|----------|-----------|-------------|
| `parseSymbolKind` | `(kind: string) => number \| undefined` | Parses a kind name or number string into an LSP SymbolKind number. Accepts numeric strings (e.g. `"5"`) or names (e.g. `"class"`, `"Function"`, case-insensitive). Uses `SYMBOL_KIND_BY_NAME` for reverse lookup. |

### Error Sanitization

| Function | Signature | Description |
|----------|-----------|-------------|
| `sanitizeError` | `(err: unknown, context: string) => string` | Sanitizes an error for safe display. Strips common internal path patterns (home directories, `C:\Users\`, `/root/`) and prefixes with the provided context string. |

```ts
sanitizeError(new Error("ENOENT: /home/user/project/src/foo.ts"), "Failed to open")
// → "Failed to open: ENOENT: ~/project/src/foo.ts"
```

### Text/Diff Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `applyEdits` | `(text: string, edits: TextEdit[]) => string` | Applies LSP TextEdits to source text. Sorts edits in reverse order to prevent offset corruption. Splits and rejoins lines correctly for multi-line edits. |
| `buildDiff` | `(filePath: string, original: string, modified: string) => string` | Produces a unified diff string in git-compatible format (`--- a/...` / `+++ b/...`). If no changes exist, outputs `@@ -0,0 +0,0 @@\n (no changes)`. |

### Constants

| Constant | Value | Used By |
|----------|-------|---------|
| `MAX_SYMBOL_RESULTS` | `50` | `find_symbols` — caps displayed results |
| `SEVERITY_NAMES` | `["?", "Error", "Warning", "Info", "Hint"]` | `lsp_diagnostics` — maps LSP severity numbers to names |
| `SYMBOL_KIND_NAMES` | `Record<number, string>` | `find_symbols`, `find_document_symbols`, `find_type_hierarchy` — maps LSP SymbolKind numbers to names (1=File through 26=TypeParameter) |
| `SYMBOL_KIND_BY_NAME` | `Record<string, number>` | `find_symbols` — reverse lookup: kind name (lowercase) → SymbolKind number |

### ToolUI Interface

```ts
interface ToolUI {
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level: "info" | "warning" | "error" | "success"): void;
}
```

Provided via `ctx.ui` in the execute function. Used for interactive prompts (e.g., confirming server installation).
