# Troubleshooting Guide

Common issues and their solutions for pi-lsp.

---

## 1. Server Won't Start

**Symptom:** LSP tool calls return `Failed to start LSP server for <language>.` or hang indefinitely.

**Causes & Fixes:**

| Cause | How to diagnose | Fix |
|-------|-----------------|-----|
| Server binary not on `$PATH` | Run the detect command manually, e.g. `typescript-language-server --version` | Install the server (see [Language Support](language-support.md) for install commands) |
| `spawn()` fails immediately | The process `error` event fires with an OS-level message (e.g. `ENOENT`) | Verify the command name in `language-config.ts` matches your system |
| Initialize handshake times out | The `initialize` request has a **60-second** timeout (`INITIALIZE_TIMEOUT_MS` in `lsp-client.ts`) | Some servers (Java, Scala) are slow — check for CPU/disk contention; the 60s window is usually sufficient |
| Server crashes during init | Process `exit` event fires before `initialize` completes | Run the server command manually with `--stdio` and check stderr output for startup errors |

**What happens internally:**

1. `LspManager.startServer()` creates a server instance with status `"starting"`
2. `LspClient.startProcess()` spawns the child process via `child_process.spawn()`
3. `LspClient.initialize()` sends the `initialize` request and waits for response
4. On any exception, the server status is set to `"error"` and the error is re-thrown
5. `getClientForConfig()` returns `null` if the final status is not `"running"`

---

## 2. Auto-Install Prompt Doesn't Appear

**Symptom:** You get `LSP server for <language> is not installed. Install: <command>` but no confirmation dialog was offered.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| The UI session doesn't support `confirm()` dialogs | Run the install command manually: e.g. `npm install -g typescript-language-server typescript` |
| `isServerInstalled()` returned `true` but the server is actually broken | The detection runs `config.detectCommand` with a **10-second** timeout. If the command exits 0, it's considered installed. Remove or fix the broken binary and retry |
| You dismissed the confirm dialog | The tool returns an error response. Re-run the tool and accept the install prompt |

**How detection works (`language-config.ts`):**

```typescript
exec(config.detectCommand, { timeout: 10000 }, (error) => {
  resolve(!error);  // exit code 0 = installed
});
```

**How auto-install works (`shared.ts`):**

1. `ensureServerInstalled()` checks `isServerInstalled(config)`
2. If not installed, prompts via `ui.confirm()` with the install command
3. Runs `exec(config.installCommand)` with a **5-minute** timeout and **10 MB** buffer
4. Verifies installation by re-running the detect command
5. If verification fails, warns: *"You may need to restart pi."*

---

## 3. Diagnostics Not Appearing After Edit

**Symptom:** You edited a file with `write` or `edit`, but no pi-lint status or notification shows.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| File path isn't absolute | The hook resolves paths against `cwd` — always use absolute paths or paths relative to your project root |
| No LSP server is running for that file extension | Check `languageFromPath()` matched your extension. Supported extensions are listed in `language-config.ts` |
| Server doesn't support the pull-model diagnostics API | pi-lsp falls back to push-model (notifications). If the server supports neither, diagnostics will be empty. Verify your server supports `textDocument/diagnostic` (LSP 3.17+) **or** sends `textDocument/publishDiagnostics` notifications |
| Individual file diagnostic check threw an error | Errors are silently swallowed in the `turn_end` handler catch block. Run `lsp_diagnostics` manually with `refresh: true` to surface the error |

**Timing details:**

- After `turn_end`, modified files are opened in parallel via `Promise.all` (no settle delay)
- Then a **1000 ms** wait for diagnostics to arrive from the server
- Only `write` and `edit` tool results trigger this flow (not `rename_symbol`, which returns a diff)

**Diagnostic flow:**

```
turn_end → manager.onFileChanged() (parallel) → 1000ms wait → getDiagnostics(refresh=true) (sequential)
```

---

## 4. `find_symbols` Returns No Results

**Symptom:** `find_symbols` returns `No symbols found matching "<query>".`

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| No LSP server is running | The tool needs an active server. Edit a file in your project first to trigger server startup |
| Server doesn't support `workspace/symbol` | Not all LSP servers implement workspace symbol search. Try a different server |
| Server discovery fell back to a server that doesn't know your symbols | Server discovery tries: (1) TypeScript server, (2) any running server, (3) scans for source files with `find` at `maxdepth 3` within **5 seconds**. If it picks the wrong server, results will be incomplete |
| Query is empty or too short | The tool rejects queries shorter than 1 character |
| `kind` parameter is too restrictive | If you specified a `kind` filter (e.g., `Function`, `Class`), the server may have no symbols matching that category. Try the query without a `kind` filter, or check the [SymbolKind](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind) enum for valid values |

**Server discovery order (`find_symbols.ts`):**

1. **TypeScript** (`typescript-language-server`) — preferred for best workspace symbol support
2. **Any running server** — iterates `LANGUAGE_SERVERS` and picks the first live client
3. **Source file scan** — runs `find cwd -maxdepth 3 -type f` looking for `.ts`, `.py`, `.js`, `.rs`, `.go`, `.java` files; picks a server based on the first match

---

## 5. `rename_symbol` Patch Is Wrong or Empty

**Symptom:** The returned diff shows no changes, incorrect ranges, or `No changes generated.`

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| `prepareRename` isn't supported by the server | The tool falls back to reading the file and extracting the word at cursor position. This may not match the symbol the server intends to rename. Check the `"oldName"` in the output to verify |
| Server returned an empty `WorkspaceEdit` | The server found no occurrences to rename (e.g., wrong position). Verify the line/column are 1-indexed and point to a valid symbol |
| File couldn't be read when building the diff | If `readFileSync(changePath)` fails (file doesn't exist, permissions), the diff falls back to showing only the `newText` with `/dev/null` as the original. Ensure all affected files are accessible |
| Edits overlap or are out of order | `applyEdits()` sorts edits in reverse order (bottom-to-top, right-to-left) to avoid offset corruption. If the server sends overlapping ranges, the result may be corrupted. Try a different position |
| `documentChanges` and `changes` formats both present | The tool processes `documentChanges` first (LSP 3.17+), then `changes` (legacy), skipping duplicates. If both contain the same file, only the `documentChanges` version is used |
| Workspace boundary filtering excluded results | Some servers restrict rename operations to files within the workspace root. Edits to files outside `rootUri` may be silently dropped. Verify all affected files are within your project root |

**Important:** The tool **does not** apply changes automatically. It returns a unified diff patch that you must apply with the `edit` tool.

---

## 6. Server Keeps Restarting (Idle Timeout)

**Symptom:** A server that was working stops responding; the next tool call takes a long time as the server restarts.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| Idle timeout (default: **5 minutes**) | Servers with no pending requests for 5 minutes are stopped. The idle checker runs every **60 seconds**. This is by design to free resources. Simply use the tool again — the server restarts automatically |
| Server process died unexpectedly | `LspClient.isAlive()` detects dead processes. `getClientForConfig()` cleans up and restarts. Check system logs for OOM kills or crashes |
| Default timeout is too aggressive | The idle timeout is configurable via the `LspManager` constructor: `new LspManager(cwd, idleTimeoutMs)`. Increase it if your workflow has long gaps between LSP operations |

**Idle check logic (`lsp-manager.ts`):**

```typescript
// Runs every 60 seconds
if (server.status === "running" 
    && server.pendingRequests.size === 0 
    && now - server.lastActive > idleTimeoutMs) {
  this.stopServer(language);  // graceful shutdown
}
```

---

## 7. Java LSP Configuration (Hardcoded Paths)

**Symptom:** Java files don't get LSP support, or the server fails to start with file-not-found errors.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| JDT LS not installed at `/opt/jdt-language-server/` | The Java config has **hardcoded paths**: command args point to `/opt/jdt-language-server/plugins/org.eclipse.equinox.launcher_*.jar` and `/opt/jdt-language-server/config_linux`. Install JDT LS there or modify the config |
| Wrong config directory for your OS | The args use `config_linux`. On macOS, change to `config_mac`. On Windows, change to `config_win` |
| Workspace data conflicts | The data directory is hardcoded to `/tmp/jdt-workspace`. Multiple pi-lsp sessions share this, which can cause index corruption. Delete `/tmp/jdt-workspace` to force a re-index |
| Java not on `$PATH` | The `detectCommand` is `java -version`. Ensure `java` is accessible. JDK 17+ is recommended for recent JDT LS versions |

**Current Java config (`language-config.ts`):**

```typescript
{
  language: "java",
  command: "java",
  args: [
    "-Declipse.application=org.eclipse.jdt.ls.core.id1",
    "-Dosgi.bundles.defaultStartLevel=4",
    "-Declipse.product=org.eclipse.jdt.ls.core.product",
    "-Dlog.level=ALL",
    "-noverify",
    "-Xmx1G",                          // Max heap: 1 GB
    "-jar",
    "/opt/jdt-language-server/plugins/org.eclipse.equinox.launcher_*.jar",
    "-configuration",
    "/opt/jdt-language-server/config_linux",
    "-data",
    "/tmp/jdt-workspace",
  ],
  extensions: [".java"],
  detectCommand: "java -version",
  installCommand: "Install Eclipse JDT Language Server (see https://github.com/eclipse-jdtls/eclipse.jdt.ls)",
}
```

---

## 8. TypeScript/JS Not Finding Definitions

**Symptom:** `find_definition` returns no results for `.ts`, `.tsx`, `.js`, or `.jsx` files.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| `typescript-language-server` installed without `typescript` | The install command is `npm install -g typescript-language-server typescript`. **Both packages are required** — `typescript-language-server` is just a protocol wrapper; the actual compiler comes from `typescript` |
| No `tsconfig.json` in the project | The TypeScript language server needs a `tsconfig.json` to resolve module paths and project structure. Create one with `npx tsc --init` |
| File opened outside project root | The server's `rootUri` is set to `cwd` (the pi session's working directory). Files outside this tree may not be resolved correctly |
| Server initialized before `tsconfig.json` existed | The server reads project configuration at startup. If you added `tsconfig.json` after the server started, stop and restart the server (or wait for the idle timeout and retry) |

**Supported extensions for TypeScript server:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`

---

## 9. Checking Server Status

**Symptom:** You want to know which LSP servers are running and their current state.

**How to check:**

The `LspManager` exposes a `getStatus()` method that returns an array of server summaries:

```
{ language: string; status: string; pid: number | null }[]
```

**Possible statuses:**

| Status | Meaning |
|--------|---------|
| `stopped` | Server is not running (initial state or after idle shutdown) |
| `starting` | Process spawned, initialize handshake in progress |
| `running` | Server is fully initialized and accepting requests |
| `stopping` | Graceful shutdown in progress |
| `error` | Server failed to start or crashed during initialization |

**PID behavior:**

- `pid` is `null` for `stopped` and `error` states
- `pid` is set after `spawn()` succeeds
- When a process exits (any code/signal), `pid` is reset to `null` and status becomes `stopped`

**Dead process detection:**

`getClientForConfig()` checks `client.isAlive()` before returning a cached client. If the process died, it calls `stopServer()` (which tries graceful shutdown, then force-kills) and restarts.

---

## 10. All Diagnostics Show as Errors

**Symptom:** Every diagnostic reported by the server appears as a red error in the UI status.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| Server reports warnings with severity `1` | LSP severity enum: `1 = Error`, `2 = Warning`, `3 = Information`, `4 = Hint`. If the server sends everything as severity `1`, that's a server-side issue, not pi-lsp |
| Misconfigured linter in the server | For Python (pylsp), check `.pylsp` config. For TypeScript, check `tsconfig.json` `strict` settings. The server decides severity based on its own configuration |
| You're reading a file with compile errors | This is expected behavior — pi-lsp faithfully reports what the server sends |
| `SEVERITY_NAMES` mapping is off | The mapping in `shared.ts` is: `["?", "Error", "Warning", "Info", "Hint"]`. Index `0` is the placeholder `"?"` — valid LSP severities start at `1` |

**How diagnostics are counted (`diagnostics.ts`):**

```typescript
const errors = diagnostics.filter((d) => d.severity === 1).length;
const warnings = diagnostics.filter((d) => d.severity === 2).length;
```

Only errors and warnings trigger UI notifications. Info and Hint severities are included in the raw diagnostic data but not shown in the status bar.

---

## 11. `hover` Returns No Information

**Symptom:** `hover` returns `"No hover information available at this position."`

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| Cursor is not on a recognizable symbol | Hover requires the cursor to be positioned on a symbol (variable, function, type, etc.). Positions on whitespace, punctuation, or keywords with no semantic meaning will return no results |
| Server doesn't support `textDocument/hover` | Not all LSP servers implement hover. Check the server's capabilities in `language-support.md` or verify by checking the `initialize` response's `capabilities.hoverProvider` |
| File hasn't been indexed yet | After opening a file, the server may need time to parse and index it before hover works. Wait a moment and retry |

**Quick diagnostic:** Try `find_definition` at the same position first. If that also returns no results, the position isn't on a valid symbol.

---

## 12. `find_type_hierarchy` Says Not Supported

**Symptom:** Returns `"Type hierarchy is not supported by this language server"`.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| Server doesn't implement type hierarchy | `textDocument/prepareTypeHierarchy` was added in LSP 3.17. Many older or simpler servers don't support it. This is a server limitation, not a pi-lsp bug |
| Cursor is not on a class, interface, or type | Type hierarchy only works when positioned on a type definition or reference. Hovering over a variable or function call will not produce results |
| Server hasn't finished analyzing the file | Some servers need full semantic analysis before type hierarchy is available. Wait for indexing to complete |

**Alternatives:** Use `find_implementations` to discover subtypes of an interface or abstract class. Use `find_definition` to navigate to the type's source directly.

---

## 13. `find_implementations` Returns Empty

**Symptom:** Returns 0 implementations for an interface or abstract class.

**Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| Cursor is not on the type name itself | `find_implementations` requires the cursor to be positioned on the interface/abstract class name, not on a method or usage within it |
| No implementations exist in the workspace | If no file in the current workspace defines a class that implements the interface, the result will be empty. This is correct behavior |
| Server hasn't finished indexing the workspace | After opening a large project, the server may not have discovered all files yet. Wait for indexing to complete (check via `lsp_status` if available) and retry |

---

## General Debugging Tips

### Run the server manually

To diagnose startup issues, run the server command with `--stdio` manually:

```bash
# TypeScript
typescript-language-server --stdio

# Python
pylsp

# Rust
rust-analyzer
```

If the server exits immediately, stderr will usually show the reason.

### Check stderr output

pi-lsp intentionally **discards** stderr output from LSP servers (they commonly log info/debug messages there). If a server is failing silently, run it manually to see stderr.

### Verify file path resolution

All LSP tools resolve file paths relative to `cwd`. If a tool can't find a file:

1. Use absolute paths
2. Ensure the file extension matches a supported language in `language-config.ts`
3. Run `languageFromPath(filePath)` to confirm a config is matched

### Request timeout

All LSP requests have a **30-second** timeout (`DEFAULT_REQUEST_TIMEOUT_MS`). The `initialize` handshake has a longer **60-second** timeout. If a request consistently times out, the server may be overloaded or stuck.
