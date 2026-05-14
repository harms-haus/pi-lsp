# Auto-Diagnostics

The auto-diagnostics subsystem automatically runs LSP diagnostics on files modified by the agent's `write` or `edit` tools. It requires no user configuration and operates transparently at the end of each turn.

## Overview

After the agent finishes a turn that includes file modifications, auto-diagnostics:

1. Identifies which files were changed during the turn
2. Notifies the LSP server about the changes
3. Waits for diagnostic results
4. Reports errors and warnings via per-file UI notifications and an aggregated status bar indicator

The subsystem is registered once at startup via `registerDiagnosticsHook(pi, manager)` in [`src/diagnostics.ts`](../src/diagnostics.ts).

## Event Flow

Auto-diagnostics operates as an event pipeline driven by the pi extension API:

```
┌─────────────────────┐
│   tool_result       │  ← write/edit tool completes
│   (per-tool-call)   │
└─────────┬───────────┘
          │ extracts file path
          │ from tool input
          ▼
┌─────────────────────┐
│   modifiedFiles Set │  ← accumulates unique resolved paths
│   (in-memory)       │
└─────────┬───────────┘
          │ turn completes
          ▼
┌─────────────────────┐
│   turn_end          │  ← diagnostics processing begins
└─────────┬───────────┘
          │ for each file:
          │   1. languageFromPath() → skip if unrecognized
          │   2. manager.onFileChanged() → send didOpen/didChange
          │   3. DIAGNOSTICS_WAIT_MS delay
          │   4. manager.getDiagnostics(refresh=true)
          │   5. Per-file ctx.ui.notify() if issues found
          ▼
┌─────────────────────┐
│   ctx.ui.setStatus  │  ← aggregated "pi-lint" status
│   ("pi-lint")       │
└─────────────────────┘
```

### Step Details

| Step | Trigger | Behavior |
|------|---------|----------|
| **Collect** | `tool_result` for `write` or `edit` | Extracts the `path` from tool input, resolves it to an absolute path (relative to `ctx.cwd`), and adds it to a `Set<string>` |
| **Turn end** | `turn_end` event | If `modifiedFiles` is non-empty, copies the set to a local array and clears it |
| **Settle** | Immediate | Waits `DIAGNOSTICS_SETTLE_DELAY_MS` (500 ms) to let the LSP server process filesystem changes |
| **Per-file check** | Loop over collected files | Calls `languageFromPath()` to filter unrecognized extensions, then `manager.onFileChanged()` to send `didOpen`/`didChange` notifications |
| **Wait** | After each `onFileChanged` | Waits `DIAGNOSTICS_WAIT_MS` (1000 ms) for diagnostics to arrive from the server |
| **Fetch** | After wait | Calls `manager.getDiagnostics(filePath, true)` — the `refresh=true` flag forces a pull-model request |
| **Notify** | If issues found | Calls `ctx.ui.notify()` per file with severity-appropriate message |
| **Status** | After all files processed | Calls `ctx.ui.setStatus("pi-lint", ...)` with aggregated counts |

## Timing Constants

Two configurable delays control the diagnostic pipeline:

| Constant | Value | Purpose |
|----------|-------|---------|
| `DIAGNOSTICS_SETTLE_DELAY_MS` | `500` ms | Initial pause after `turn_end` before processing begins, allowing the LSP server to pick up filesystem changes |
| `DIAGNOSTICS_WAIT_MS` | `1000` ms | Wait after `onFileChanged()` for each file, giving the server time to compute and deliver diagnostics |

### Total Delay Formula

For a turn that modifies **N** recognized files:

```
total_delay = DIAGNOSTICS_SETTLE_DELAY_MS + (N × DIAGNOSTICS_WAIT_MS)
            = 500 + (N × 1000) ms
```

Examples:

| Files modified | Approximate total delay |
|----------------|------------------------|
| 1 | ~1.5 s |
| 3 | ~3.5 s |
| 5 | ~5.5 s |

The per-file wait is **sequential** — each file's `onFileChanged()` → wait → `getDiagnostics()` chain completes before the next file begins. This ensures the LSP server isn't overwhelmed with concurrent requests but means multi-file turns take proportionally longer.

## Status Bar Integration

The aggregated diagnostic result is published to the pi UI via `ctx.ui.setStatus()` with the key `"pi-lint"`:

| Condition | Status text |
|-----------|-------------|
| No issues across all checked files | `"✓ clean"` |
| 1 error | `"1 error"` |
| 2 errors, 3 warnings | `"2 errors, 3 warnings"` |
| 4 warnings | `"4 warnings"` |

The status uses a `pluralize()` helper that formats counts as `"1 error"` (singular) or `"N errors"` (plural). Errors and warnings are joined with `", "` in that order.

The status bar entry is **only set** when `filesChecked > 0` — if all modified files had unrecognized extensions, no status is published.

## Per-File Notifications

When a file has diagnostic issues (errors or warnings), the agent receives a UI notification:

```typescript
ctx.ui.notify(
  `${fileName}: ${parts.join(", ")}`,   // e.g. "index.ts: 2 errors, 1 warning"
  errors > 0 ? "error" : "warning"       // notification severity
);
```

| Property | Detail |
|----------|--------|
| **Message format** | `"filename.ext: N error(s), M warning(s)"` — only the affected severity types are included |
| **Notification severity** | `"error"` if any errors exist, otherwise `"warning"` |
| **Threshold** | Only fires when `errors > 0 || warnings > 0` — info/hint severity (3/4) do not trigger notifications |
| **Scope** | One notification per affected file, using the base filename (not the full path) |

Severity values follow the [LSP DiagnosticSeverity](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnosticSeverity) enum:

| Value | Meaning | Triggers notification? |
|-------|---------|----------------------|
| `1` | Error | Yes |
| `2` | Warning | Yes |
| `3` | Information | No |
| `4` | Hint | No |

## Language Filtering

Only files with recognized extensions trigger diagnostics. The `languageFromPath()` function from [`language-config.ts`](../src/language-config.ts) maps a file path to an `LspServerConfig`:

```typescript
const config = languageFromPath(filePath);
if (!config) continue;  // silently skip
```

The function extracts the file extension (substring from the last `.`) and looks it up in the `LANGUAGE_SERVERS` array. Files without an extension, or with extensions not registered in any `LspServerConfig`, are silently skipped.

**Example:** In a turn where the agent modifies `src/index.ts`, `README.md`, and `Makefile`:

| File | Recognized? | Action |
|------|-------------|--------|
| `src/index.ts` | Yes (`.ts` → TypeScript) | Diagnostics run |
| `README.md` | Yes (`.md` → Markdown) | Diagnostics run |
| `Makefile` | No (no extension) | Skipped |

See [Supported Languages](../README.md#supported-languages) in the README for the full list of 33 registered language configurations.

## Error Handling

All errors during the diagnostic pipeline are **silently swallowed**:

```typescript
for (const filePath of filesToCheck) {
  try {
    // ... diagnostics logic
  } catch {
    // Ignore errors from individual file checks
  }
}
```

This means:

- A failed LSP server (crashed, unreachable, not installed) does **not** block diagnostics for other files in the same turn
- No error messages are surfaced to the user — a file simply gets omitted from the count
- The status bar is still published with results from files that were successfully checked
- The `modifiedFiles` set is always cleared at `turn_end`, regardless of success or failure

The design prioritizes **non-interference**: auto-diagnostics should never prevent the agent from continuing its work.

## Interaction with `lsp_diagnostics` Tool

Auto-diagnostics and the manual `lsp_diagnostics` tool share the same underlying infrastructure in [`LspManager`](../src/lsp-manager.ts):

### Shared Diagnostics Cache

Each `LspServerInstance` maintains a `diagnostics: Map<string, Diagnostic[]>` cache keyed by file URI. This cache is populated by two mechanisms:

| Mechanism | Source | Trigger |
|-----------|--------|---------|
| **Push model** | `textDocument/publishDiagnostics` notification from the LSP server | Received asynchronously via `handleDiagnosticsNotification()` |
| **Pull model** | `textDocument/diagnostic` request (LSP 3.17+) | Triggered by `getDiagnostics(filePath, refresh=true)` |

The `handleNotification()` method in `LspManager` intercepts `textDocument/publishDiagnostics` notifications and writes them to the cache:

```typescript
handleDiagnosticsNotification(language: string, uri: string, diagnostics: Diagnostic[]): void {
  const server = this.state.servers.get(language);
  if (server) {
    server.diagnostics.set(uri, diagnostics);
    server.lastActive = Date.now();
  }
}
```

### Refresh Behavior

The `refresh` parameter in `manager.getDiagnostics(filePath, refresh)` controls cache usage:

| `refresh` | Behavior |
|-----------|----------|
| `false` (default) | Returns cached diagnostics if available; only falls back to pull-model request if the cache has no entry for the URI |
| `true` | Forces a pull-model `textDocument/diagnostic` request, overwriting the cache with fresh results |

**Auto-diagnostics always passes `refresh=true`**, ensuring it gets the latest results from the server after each file change.

**The `lsp_diagnostics` tool** defaults to `refresh=false` (user must explicitly request a refresh), which returns the cached result from the last auto-diagnostics run or server notification — making repeated tool calls fast.

### Data Flow Comparison

```
Auto-diagnostics (src/diagnostics.ts)          Manual tool (src/index.ts)
──────────────────────────────────────         ────────────────────────────
turn_end event                                 Agent calls lsp_diagnostics
  │                                              │
  ├─ manager.onFileChanged()                    ├─ manager.getDiagnostics(file)
  │   (sends didOpen/didChange)                 │   (refresh=false by default)
  │                                              │
  ├─ 1000 ms wait                                ├─ Returns cached diagnostics
  │                                              │   (fast, no server request)
  └─ manager.getDiagnostics(file, true)
      (forces fresh pull-model request)
```

Both paths ultimately read from the same `server.diagnostics` cache. The difference is that auto-diagnostics proactively refreshes the cache after modifications, while the manual tool reads whatever is currently cached unless the user explicitly requests `refresh=true`.
