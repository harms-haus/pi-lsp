---
name: scouting-and-debugging
description: Guidance for using 11 LSP-powered tools to scout, navigate, and debug code with language server intelligence. Covers find_references, find_definition, find_symbols, find_calls, find_implementations, find_type_definition, find_document_symbols, hover, find_type_hierarchy, rename_symbol, and lsp_diagnostics. Supports 33+ languages.
---

# LSP Tools for Scouting & Debugging

The pi-lsp extension provides 11 tools backed by Language Server Protocol servers. These tools understand your code semantically — not just text matching — giving you accurate navigation, inspection, and refactoring capabilities.

## Tool Overview

A comparison table mapping what you used to grep for → which tool replaces it:

| Instead of... | Use... | Why |
|---|---|---|
| `grep -rn "symbolName"` | find_references | All usages, no false positives |
| `grep -rn "class X\|def X"` | find_definition | Language-aware, skips comments |
| `grep -rn "ClassName"` | find_symbols | Structured results with kind |
| `grep -rn "funcName(" *.ts` | find_calls | Actual callers + callees |
| `grep -rn "implements Foo"` | find_implementations | Accurate, no false positives |
| Multi-step type tracing | hover | Type/signature at a glance |
| `grep -n "def\|class\|function" file` | find_document_symbols | File outline without reading whole file |
| Multi-step type tracing | find_type_definition | Jump to type definition |
| Recursive `grep -rn "extends"` | find_type_hierarchy | Full inheritance chain |
| `grep -rl` + `sed -i` | rename_symbol | Safe rename across files |
| Reading compiler output | lsp_diagnostics | Real-time errors & warnings |

## Quick Reference

### lsp_diagnostics — Check for errors and warnings

**When:** After editing files, when code behaves unexpectedly, or to verify code quality.

**Parameters:**
- `file` (string) — Path to the file to check
- `refresh` (boolean, optional) — Force a fresh re-analysis
- `workspace` (boolean, optional) — Scan all open files for workspace-wide diagnostics

**Examples:**
```
lsp_diagnostics(file="src/index.ts")
lsp_diagnostics(file="src/index.ts", refresh=true)
lsp_diagnostics(workspace=true)
```

**Tips:**
- Run without `refresh` for fast cached results; use `refresh=true` after substantial edits.
- The tool reports errors, warnings, and info messages with file:line:col locations.
- After `write` or `edit` tool calls, diagnostics run automatically — but you can manually re-check if needed.

---

### find_definition — Find where a symbol is defined

**When:** You need to read the implementation of a function, class, variable, or type.

**Parameters:**
- `file` (string) — Path to the file containing the symbol usage
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)

**Examples:**
```
find_definition(file="src/app.ts", line=42, column=10)
```

**Tips:**
- Position on the **name** of the symbol, not inside a string or comment.
- For `import { Foo } from "./bar"`, put the cursor on `Foo` to jump to its definition in `bar.ts`.
- Returns zero or more locations — some symbols have multiple definitions (overloads, interfaces + implementations).

---

### find_references — Find all usages of a symbol

**When:** Understanding impact of a change, before renaming, deleting, or modifying.

**Parameters:**
- `file` (string) — Path to the file
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)

**Examples:**
```
find_references(file="src/types.ts", line=20, column=18)
```

**Tips:**
- Place the cursor on the symbol's **declaration** to find all usages, or on a **usage** to find the declaration + other usages.
- Includes the declaration site itself in results.
- Use before `rename_symbol` to understand the scope of a rename.

---

### find_symbols — Search for symbols across the workspace

**When:** You know a symbol name and need to find where it's defined. Exploring a codebase.

**Parameters:**
- `query` (string) — Fuzzy symbol name to search for
- `kind` (string, optional) — Filter by symbol kind (e.g. "class", "function", "interface")

**Examples:**
```
find_symbols(query="LspManager")
find_symbols(query="handle", kind="function")
```

**Tips:**
- Supports fuzzy/partial matching — `"handleReq"` finds `handleRequest`, `handleRequestBody`, etc.
- Returns the symbol kind (Class, Function, Interface, Variable, etc.) and location.
- Works across the entire workspace, not just the current file.

---

### find_document_symbols — List all symbols in a file

**When:** Understanding file structure, getting an overview before reading.

**Parameters:**
- `file` (string) — Path to the file

**Examples:**
```
find_document_symbols(file="src/lsp-manager.ts")
```

**Tips:**
- Returns a structured outline of classes, functions, variables, and their ranges.
- Use before reading a file to understand its layout and identify interesting symbols.
- Faster than reading the entire file when you only need structure.

---

### find_calls — Map function call relationships

**When:** Understanding how functions call each other. Finding callers before modifying.

**Parameters:**
- `file` (string) — Path to the file
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)

**Examples:**
```
find_calls(file="src/lsp-manager.ts", line=44, column=9)
```

**Tips:**
- Position on the **function/method name in its declaration**, not at a call site.
- Returns **incoming calls** (who calls this function) and **outgoing calls** (what this function calls).
- Works best with methods and functions — not variables or types.

---

### hover — Get type information at a position

**When:** You need to know the type of an expression, function signature, or documentation.

**Parameters:**
- `file` (string) — Path to the file
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)

**Examples:**
```
hover(file="src/app.ts", line=42, column=10)
```

**Tips:**
- Shows type, documentation, and signature information inline.
- Useful for quickly checking what a variable holds or what a function expects.
- Pair with `find_type_definition` to jump from a hover result to the type source.

---

### find_implementations — Find interface implementations

**When:** Finding all classes that implement an interface, or all concrete types for an abstract type.

**Parameters:**
- `file` (string) — Path to the file
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)

**Examples:**
```
find_implementations(file="src/types.ts", line=5, column=18)
```

**Tips:**
- Position on the interface or abstract class name.
- Returns all concrete implementations with file and location.
- Pair with `find_calls` on each implementation to see how they're used.

---

### find_type_definition — Jump to type definition

**When:** From a variable or parameter, jump to where its type is defined.

**Parameters:**
- `file` (string) — Path to the file
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)

**Examples:**
```
find_type_definition(file="src/app.ts", line=15, column=8)
```

**Tips:**
- Works on variables, parameters, and return types — jumps to the type's source definition.
- Different from `find_definition`: `find_definition` goes to the variable itself; this goes to its **type**.
- Useful when you see `const x: Foo` and want to read `Foo`'s definition.

---

### find_type_hierarchy — Show inheritance chain

**When:** Understanding type inheritance, finding parent and child types.

**Parameters:**
- `file` (string) — Path to the file
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)

**Examples:**
```
find_type_hierarchy(file="src/types.ts", line=10, column=18)
```

**Tips:**
- Not all language servers support type hierarchy. The tool provides a graceful fallback message when unsupported.
- Shows both supertypes (parents) and subtypes (children).
- Pair with `find_type_definition` on parent types to navigate up the chain.

---

### rename_symbol — Rename a symbol across the codebase

**When:** Renaming a function, class, variable, or type across multiple files.

**Parameters:**
- `file` (string) — Path to the file
- `line` (number) — Line number (1-indexed)
- `column` (number) — Column number (1-indexed)
- `newName` (string) — The new name

**Examples:**
```
rename_symbol(file="src/types.ts", line=20, column=18, newName="ServerConfig")
```

**Tips:**
- ⚠️ This tool does **NOT** apply the rename. It returns a unified diff patch.
- Show the patch to the user, then use the `edit` tool to apply each change.
- Use `find_references` first to understand scope before renaming.
- Works across all files that reference the symbol — imports, usages, type annotations.

## Common Workflows

### 1. Scout an unfamiliar file
1. `find_document_symbols(file="src/index.ts")` — Get the file outline
2. `hover(file, line, col)` on interesting symbols — Check types and signatures
3. `find_calls(file, line, col)` on key functions — Trace the call graph

### 2. Trace a bug
1. `lsp_diagnostics(file, refresh=true)` — Get all errors
2. `find_definition(file, line, col)` — Go to the source of the problem
3. `hover(file, line, col)` — Check types at error locations
4. `find_references(file, line, col)` — Find all usages that might be affected

### 3. Understand an interface
1. `find_implementations(file, line, col)` — Find all concrete implementations
2. `find_calls(file, line, col)` on each impl — See how they're used
3. `hover(file, line, col)` — Check signatures and documentation

### 4. Trace inheritance
1. `find_type_hierarchy(file, line, col)` — See full inheritance chain
2. `find_type_definition(file, line, col)` on parent — Jump to parent type source
3. `find_references(file, line, col)` on parent methods — See where inherited methods are used

### 5. Safe rename
1. `find_references(file, line, col)` — Review the full scope of the rename
2. `rename_symbol(file, line, col, newName="X")` — Get the diff patch
3. Apply the patch with `edit(...)` — Apply each change

### 6. Verify after edits
1. `edit(...)` or `write(...)` — Make your changes
2. `lsp_diagnostics(file, refresh=true)` — Confirm no errors introduced

## Conventions

- **Line and column are 1-indexed** — Line 1 = first line, Column 1 = first character.
- **lsp_diagnostics keeps the `lsp_` prefix** — to distinguish from test/build diagnostics.
- **All other tools drop the `lsp_` prefix** — for cleaner agent discoverability.

## Supported Languages

TypeScript, Python, Rust, Go, Java, C/C++, C#, PHP, Ruby, Lua, HTML, CSS, JSON, YAML, Markdown, Dart, Kotlin, Swift, Zig, Haskell, OCaml, Elixir, Scala, Terraform, Dockerfile, SQL, Vue, Svelte, TOML, Nix, LaTeX, R, Bash

LSP servers auto-install on first use (with user confirmation).

## Slash Command

`/lsp-status` — Show status of all running LSP servers
