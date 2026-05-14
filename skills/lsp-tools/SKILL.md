---
name: lsp-tools
description: Guidance for using the 6 LSP tools (lsp_diagnostics, lsp_find_references, lsp_refactor_symbol, lsp_goto_definition, lsp_find_symbol, lsp_call_hierarchy) to analyze, navigate, and refactor code with language server intelligence. Use when working with code in any of the 33+ supported languages (TypeScript, Python, Rust, Go, C/C++, Java, and more).
---

# LSP Tools

The pi-lsp extension provides 6 tools backed by Language Server Protocol servers. These tools understand your code semantically — not just text matching — giving you accurate navigation, refactoring, and diagnostics.

## When to Use LSP Tools

Use LSP tools **instead of** `grep`/`rg`/`find` when you need **semantic understanding** of code:

| Instead of... | Use... | Because... |
|---|---|---|
| `grep -rn "symbolName"` | `lsp_find_references` | Finds only actual references, not comments/strings/false matches |
| Guessing where something is defined | `lsp_goto_definition` | Goes to the exact definition, even across files |
| Manual find-and-replace | `lsp_refactor_symbol` | Renames everywhere the symbol is used, safely |
| `grep` for a class/function | `lsp_find_symbol` | Fuzzy search across the whole workspace by name and kind |
| Manual error checking | `lsp_diagnostics` | Gets compiler-accurate errors and warnings |
| Guessing call relationships | `lsp_call_hierarchy` | Maps actual caller/callee relationships |

## Tool Reference

### lsp_diagnostics — Check for errors and warnings

**When:** After editing files, when code behaves unexpectedly, or to verify code quality.

**Parameters:**
- `file` (string) — Path to the file to check
- `refresh` (boolean, optional) — Force a fresh re-analysis. Use after making edits that the server may not have picked up.

**Examples:**
```
lsp_diagnostics(file="src/index.ts")
lsp_diagnostics(file="src/index.ts", refresh=true)
```

**Workflow tips:**
- Run without `refresh` for fast cached results; use `refresh=true` after substantial edits.
- The tool reports errors, warnings, and info messages with file:line:col locations.
- After `write` or `edit` tool calls, diagnostics run automatically — but you can manually re-check if needed.

---

### lsp_goto_definition — Find where a symbol is defined

**When:** You need to read the implementation of a function, class, variable, or type. You see a symbol used somewhere and want to jump to its definition.

**Parameters:**
- `file` (string) — Path to the file containing the symbol usage
- `line` (number) — Line number where the symbol appears (1-indexed)
- `column` (number) — Column number where the symbol starts (1-indexed)

**Examples:**
```
lsp_goto_definition(file="src/app.ts", line=42, column=10)
```

**Workflow tips:**
- Position the cursor on the **name** of the symbol, not inside a string or comment.
- For `import { Foo } from "./bar"`, put the cursor on `Foo` to jump to its definition in `bar.ts`.
- Returns zero or more locations — some symbols have multiple definitions (overloads, interfaces + implementations).
- Use after finding a reference to trace back to the source.

---

### lsp_find_references — Find all usages of a symbol

**When:** You need to know every place a function, class, variable, or type is used — before renaming, deleting, or modifying it. Understanding impact of a change.

**Parameters:**
- `file` (string) — Path to the file containing the symbol
- `line` (number) — Line number of the symbol (1-indexed)
- `column` (number) — Column number of the symbol (1-indexed)

**Examples:**
```
lsp_find_references(file="src/types.ts", line=20, column=18)
```

**Workflow tips:**
- Place the cursor on the symbol's **declaration** to find all usages, or on a **usage** to find the declaration + other usages.
- Includes the declaration site itself in results.
- Use before `lsp_refactor_symbol` to understand the scope of a rename.

---

### lsp_refactor_symbol — Rename a symbol across the codebase

**When:** Renaming a function, class, variable, type, or any identifier across multiple files. Safer and more accurate than find-and-replace.

**Parameters:**
- `file` (string) — Path to the file containing the symbol
- `line` (number) — Line number of the symbol (1-indexed)
- `column` (number) — Column number of the symbol (1-indexed)
- `newName` (string) — The new name for the symbol

**Examples:**
```
lsp_refactor_symbol(file="src/types.ts", line=20, column=18, newName="ServerConfig")
```

**Workflow tips:**
- ⚠️ This tool does **NOT** apply the rename. It returns a unified diff patch.
- Show the patch to the user, then use the `edit` tool to apply each change.
- Use `lsp_find_references` first to understand scope before renaming.
- Works across all files that reference the symbol — imports, usages, type annotations.

---

### lsp_find_symbol — Search for symbols across the workspace

**When:** You know a symbol name (or partial name) and need to find where it's defined. Exploring a codebase. Looking for classes, functions, or types by name.

**Parameters:**
- `query` (string) — Fuzzy symbol name to search for

**Examples:**
```
lsp_find_symbol(query="LspManager")
lsp_find_symbol(query="handleReq")
```

**Workflow tips:**
- Supports fuzzy/partial matching — `"handleReq"` finds `handleRequest`, `handleRequestBody`, etc.
- Returns the symbol kind (Class, Function, Interface, Variable, etc.) and location.
- Best for discovery — "Where is the `User` class?" or "What functions contain 'auth'?"
- Works across the entire workspace, not just the current file.
- For TypeScript/JavaScript projects, requires a `tsconfig.json` in the project root.

---

### lsp_call_hierarchy — Map function call relationships

**When:** Understanding how functions call each other. Finding all callers of a function before modifying it. Tracing execution flow.

**Parameters:**
- `file` (string) — Path to the file containing the function
- `line` (number) — Line number of the function name (1-indexed)
- `column` (number) — Column number of the function name (1-indexed)

**Examples:**
```
lsp_call_hierarchy(file="src/lsp-manager.ts", line=44, column=9)
```

**Workflow tips:**
- Position on the **function/method name in its declaration**, not at a call site.
- Returns **incoming calls** (who calls this function) and **outgoing calls** (what this function calls).
- Works best with methods and functions — not variables or types.
- Use to understand impact before refactoring: "If I change this function, who will break?"

---

## Common Workflows

### Workflow 1: Understand a symbol before modifying it
```
1. lsp_goto_definition(file, line, col)    → Find the definition
2. lsp_find_references(file, line, col)    → See all usages
3. lsp_call_hierarchy(file, line, col)     → Map call relationships
```

### Workflow 2: Safe rename across the codebase
```
1. lsp_find_references(file, line, col)                → Check scope
2. lsp_refactor_symbol(file, line, col, newName="X")   → Get patch
3. edit(...)                                            → Apply the patch
```

### Workflow 3: Verify code after edits
```
1. edit(...) or write(...)                              → Make changes
2. lsp_diagnostics(file, refresh=true)                  → Check for errors
```

### Workflow 4: Explore an unfamiliar codebase
```
1. lsp_find_symbol(query="main")                       → Find entry points
2. lsp_call_hierarchy(file, line, col)                 → Trace call graph
3. lsp_goto_definition(file, line, col)                → Dive into implementations
```

## Line and Column Conventions

All tools use **1-indexed** line and column numbers:
- Line 1 = first line of the file
- Column 1 = first character on the line

When in doubt, use `read` to inspect the file and count from the top.

## Supported Languages

TypeScript, JavaScript, Python, Rust, Go, C/C++, C#, Java, PHP, Ruby, Lua, HTML, CSS, SCSS, LESS, JSON, YAML, Markdown, Dart, Kotlin, Swift, Zig, Haskell, OCaml, Elixir, Scala, Terraform, Dockerfile, SQL, Vue, Svelte, TOML, Nix, LaTeX, R, Bash.

LSP servers auto-install on first use (with user confirmation).

## /lsp-status Command

Run `/lsp-status` to see which LSP servers are currently running and their process IDs.
