# pi-lsp

LSP (Language Server Protocol) integration extension for [pi](https://github.com/earendil-works/pi-coding-agent).

## Features

- **Auto-diagnostics on edit/write**: Automatically runs LSP diagnostics after `write` or `edit` tool calls complete
- **6 LSP tools**: diagnostics, find-references, refactor-symbol, goto-definition, find-symbol, call-hierarchy (tool names use snake_case: `lsp_diagnostics`, `lsp_find_references`, `lsp_refactor_symbol`, `lsp_goto_definition`, `lsp_find_symbol`, `lsp_call_hierarchy`)
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

## Development

```bash
npm install          # Install dependencies
npm run lint           # Lint source code
npm run lint:fix       # Auto-fix lint issues
npm run typecheck      # Type-check without emitting
npm test               # Run test suite (96 tests)
npm run test:coverage  # Run tests with coverage report
npm run test:watch     # Run tests in watch mode
```

No build step required — pi loads TypeScript source directly.

## Tools

### lsp_diagnostics

Run diagnostics on a file. Shows errors, warnings, and info messages.

```
lsp_diagnostics(file="src/index.ts", refresh=false)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file to check |
| `refresh` | boolean (optional) | Force refresh diagnostics from the server |

### lsp_find_references

Find all references to the symbol at the given position.

```
lsp_find_references(file="src/index.ts", line=42, column=10)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file |
| `line` | number | Line number (1-indexed) |
| `column` | number | Column number (1-indexed) |

### lsp_refactor_symbol

Rename a symbol and return a unified diff patch. **Does not auto-apply.**

```
lsp_refactor_symbol(file="src/index.ts", line=42, column=10, newName="newName")
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file |
| `line` | number | Line number (1-indexed) |
| `column` | number | Column number (1-indexed) |
| `newName` | string | New name for the symbol |

### lsp_goto_definition

Find the definition of a symbol at the given position.

```
lsp_goto_definition(file="src/index.ts", line=42, column=10)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to the file |
| `line` | number | Line number (1-indexed) |
| `column` | number | Column number (1-indexed) |

### lsp_find_symbol

Fuzzy search for symbols across the workspace.

```
lsp_find_symbol(query="MyClass")
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Fuzzy symbol name to search for |

### lsp_call_hierarchy

Show call hierarchy for a function (incoming and outgoing calls).

```
lsp_call_hierarchy(file="src/index.ts", line=42, column=10)
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

> **Note:** Bare filenames without a dot prefix (e.g. `Dockerfile`) are not matched by the current extension detection logic — only `.dockerfile` files are detected automatically.

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
│  src/tools/                                             │
│  ├── shared.ts             # Shared tool utilities      │
│  ├── diagnostics.ts        # lsp_diagnostics tool       │
│  ├── find-references.ts    # lsp_find_references tool   │
│  ├── refactor-symbol.ts    # lsp_refactor_symbol tool   │
│  ├── goto-definition.ts    # lsp_goto_definition tool   │
│  ├── find-symbol.ts        # lsp_find_symbol tool       │
│  └── call-hierarchy.ts     # lsp_call_hierarchy tool    │
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

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Deep system architecture: modules, data flow, state machines |
| [Development](docs/development.md) | Setup, commands, project structure |
| [Tool Implementation](docs/tools-guide.md) | How tools work, preamble pattern, per-tool details |
| [Auto-Diagnostics](docs/auto-diagnostics.md) | Event-driven diagnostics after file edits |
| [Language Support](docs/language-support.md) | Adding new language servers |
| [Testing](docs/testing.md) | Test strategy, patterns, fixtures |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

## Contributing

1. Fork or clone the repository
2. Create a feature branch
3. Make changes with tests
4. Run `npm run lint && npm run typecheck && npm test`
5. Submit a pull request

See [docs/development.md](docs/development.md) for detailed setup instructions.
