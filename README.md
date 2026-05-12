# pi-lsp

LSP (Language Server Protocol) integration extension for [pi](https://github.com/earendil-works/pi-coding-agent).

## Features

- **Auto-diagnostics on edit/write**: Automatically runs LSP diagnostics after `write` or `edit` tool calls complete
- **6 LSP tools**: diagnostics, find-references, refactor-symbol, goto-definition, find-symbol, call-hierarchy
- **Auto-install**: Detects missing LSP servers and prompts to install them on first use
- **Persistent servers**: LSP servers stay alive with a 5-minute idle timeout
- **33 languages supported**: From TypeScript to Zig, with installation commands for each

## Installation

```bash
# Clone or copy to global extensions
cp -r pi-lsp ~/.pi/agent/extensions/pi-lsp

# Install dependencies
cd ~/.pi/agent/extensions/pi-lsp
npm install
```

Or for project-local use:

```bash
cp -r pi-lsp .pi/extensions/pi-lsp
cd .pi/extensions/pi-lsp && npm install
```

## Tools

### lsp-diagnostics

Run diagnostics on a file. Shows errors, warnings, and info messages.

```
lsp-diagnostics(file="src/index.ts", refresh=false)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file to check |
| `refresh` | boolean (optional) | Force refresh diagnostics from the server |

### lsp-find-references

Find all references to the symbol at the given position.

```
lsp-find-references(file="src/index.ts", line=42, column=10)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file |
| `line` | number | Line number (1-indexed) |
| `column` | number | Column number (1-indexed) |

### lsp-refactor-symbol

Rename a symbol and return a unified diff patch. **Does not auto-apply.**

```
lsp-refactor-symbol(file="src/index.ts", line=42, column=10, newName="newName")
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file |
| `line` | number | Line number (1-indexed) |
| `column` | number | Column number (1-indexed) |
| `newName` | string | New name for the symbol |

### lsp-goto-definition

Find the definition of a symbol at the given position.

```
lsp-goto-definition(file="src/index.ts", line=42, column=10)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file |
| `line` | number | Line number (1-indexed) |
| `column` | number | Column number (1-indexed) |

### lsp-find-symbol

Fuzzy search for symbols across the workspace.

```
lsp-find-symbol(query="MyClass")
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Fuzzy symbol name to search for |

### lsp-call-hierarchy

Show call hierarchy for a function (incoming and outgoing calls).

```
lsp-call-hierarchy(file="src/index.ts", line=42, column=10)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file |
| `line` | number | Line number (1-indexed) |
| `column` | number | Column number (1-indexed) |

## Commands

### /lsp-status

Show the status of all running LSP servers.

## Supported Languages

| Language | Extensions | Server | Install |
|----------|-----------|--------|---------|
| TypeScript/JavaScript | .ts, .tsx, .js, .jsx, .mjs, .cjs | typescript-language-server | `npm install -g typescript-language-server typescript` |
| Python | .py | pylsp | `pip install python-lsp-server` |
| Rust | .rs | rust-analyzer | `rustup component add rust-analyzer` |
| Go | .go | gopls | `go install golang.org/x/tools/gopls@latest` |
| Java | .java | Eclipse JDT LS | Download from GitHub |
| C/C++ | .c, .cpp, .cc, .cxx, .h, .hpp, .hxx | clangd | `apt install clangd` |
| C# | .cs | OmniSharp | `dotnet tool install -g omnisharp` |
| PHP | .php | intelephense | `npm install -g intelephense` |
| Ruby | .rb | ruby-lsp | `gem install ruby-lsp` |
| Lua | .lua | lua-language-server | `npm install -g lua-language-server` |
| HTML | .html, .htm | html-languageserver | `npm install -g vscode-html-languageserver-bin` |
| CSS/SCSS/LESS | .css, .scss, .less | css-languageserver | `npm install -g vscode-css-languageserver-bin` |
| JSON | .json, .jsonc | json-languageserver | `npm install -g vscode-json-languageserver-bin` |
| YAML | .yaml, .yml | yaml-language-server | `npm install -g yaml-language-server` |
| Markdown | .md | markdown-language-server | `npm install -g vscode-markdown-languageserver` |
| Dart | .dart | dart language-server | Install Dart SDK |
| Kotlin | .kt, .kts | kotlin-language-server | Download from GitHub |
| Swift | .swift | sourcekit-lsp | Included with Swift >= 5.6 |
| Zig | .zig | zls | Download from GitHub |
| Haskell | .hs, .lhs | haskell-language-server | `ghcup install hls` |
| OCaml | .ml, .mli | ocamllsp | `opam install ocaml-lsp-server` |
| Elixir | .ex, .exs | elixir-ls | Download from GitHub |
| Scala | .scala, .sbt | metals | `cs install metals` |
| Terraform/HCL | .tf, .tfvars, .hcl | terraform-ls | Download from GitHub |
| Dockerfile | Dockerfile, .dockerfile | dockerfile-language-server-nodejs | `npm install -g dockerfile-language-server-nodejs` |
| SQL | .sql | sql-language-server | `npm install -g sql-language-server` |
| Vue | .vue | vue-language-server | `npm install -g @vue/language-server` |
| Svelte | .svelte | svelteserver | `npm install -g svelte-language-server` |
| TOML | .toml | taplo | `npm install -g @taplo/lsp` |
| Nix | .nix | nil | `nix profile install nixpkgs#nil` |
| LaTeX | .tex, .latex | texlab | `cargo install texlab` |
| R | .r, .R | languageserver | `R -e 'install.packages("languageserver")'` |
| Bash/Shell | .sh, .bash | bash-language-server | `npm install -g bash-language-server` |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      pi Extension                        │
├─────────────────────────────────────────────────────────┤
│  index.ts                                               │
│  ├── Session lifecycle (session_start, session_shutdown) │
│  ├── 6 Tool registrations                               │
│  └── /lsp-status command                                │
├─────────────────────────────────────────────────────────┤
│  lsp-manager.ts                                         │
│  ├── Server lifecycle (start, stop, idle timeout)       │
│  ├── File open/change tracking                          │
│  └── Notification handling (diagnostics)                │
├─────────────────────────────────────────────────────────┤
│  lsp-client.ts                                          │
│  ├── JSON-RPC over stdio                                │
│  ├── LSP protocol methods                               │
│  └── Request/Response/Notification handling             │
├─────────────────────────────────────────────────────────┤
│  language-config.ts                                     │
│  └── 33 language server configurations                  │
├─────────────────────────────────────────────────────────┤
│  diagnostics.ts                                         │
│  └── Auto-diagnostics hook on write/edit tools          │
├─────────────────────────────────────────────────────────┤
│  types.ts                                               │
│  └── Shared type definitions                            │
└─────────────────────────────────────────────────────────┘
```

## Server Lifecycle

1. **Auto-start**: When editing/writing a file with a configured LSP, the server starts automatically
2. **Auto-install**: If the server isn't installed, the user is prompted to install it
3. **Persistent**: Servers stay alive across tool calls with a 5-minute idle timeout
4. **Auto-restart**: If a server crashes, it restarts on the next tool invocation
5. **Graceful shutdown**: All servers are shut down when pi exits (`session_shutdown`)
