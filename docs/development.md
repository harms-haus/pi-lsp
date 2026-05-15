# Development Guide

Developer onboarding guide for the pi-lsp extension.

## Prerequisites

- **Node.js** (v20+ recommended) — runtime for the extension and tooling
- **npm** — package manager (ships with Node.js)
- **pi-coding-agent** — the host application that loads this extension
- **At least one LSP server** installed globally (e.g. `typescript-language-server`, `pylsp`) to exercise the tools during development

## Setup

1. Clone or copy the extension into the pi extensions directory:

```bash
# Global extensions
cp -r pi-lsp ~/.pi/agent/extensions/pi-lsp

# Or project-local
cp -r pi-lsp .pi/extensions/pi-lsp
```

2. Install dependencies:

```bash
cd ~/.pi/agent/extensions/pi-lsp  # adjust path as needed
npm install
```

No build step is required. See [No Build Step](#no-build-step) below.

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run lint` | Run ESLint on `src/` (read-only, reports errors and warnings) |
| `npm run lint:fix` | Run ESLint on `src/` and auto-fix applicable issues |
| `npm run typecheck` | Run `tsc --noEmit` to type-check without producing output files |
| `npm run test` | Run the full test suite once (unit + integration) |
| `npm run test:watch` | Run vitest in watch mode — re-runs on file changes |
| `npm run test:coverage` | Run tests with coverage reporting |

Recommended workflow: keep `npm run test:watch` running in one terminal while editing, and run `npm run typecheck` before committing.

## Test Suite

The test suite consists of **113 tests across 16 files**: 106 passed, 7 skipped.

| Layer | Files | Description |
|-------|-------|-------------|
| Unit | 5 | `diagnostics`, `language-config`, `lsp-client`, `lsp-manager`, `shared` |
| Integration | 11 | One file per LSP tool (diagnostics, find_references, find_definition, find_symbols, find_calls, rename_symbol, find_document_symbols, hover, find_implementations, find_type_definition, find_type_hierarchy) |

## Project Structure

```
pi-lsp/
├── package.json                  # Extension metadata, scripts, and pi extension entry point
├── package-lock.json             # Locked dependency versions
├── tsconfig.json                 # TypeScript compiler configuration
├── vitest.config.ts              # Vitest test runner configuration
├── eslint.config.mjs             # ESLint flat config (TypeScript-aware)
├── .gitignore                    # Ignored files (node_modules, .DS_Store, .bifrost.yaml)
├── .bifrost.yaml                 # Bifrost CI/CD pipeline config
├── README.md                     # User-facing documentation
│
├── src/
│   ├── index.ts                  # Extension entry point — lifecycle, tool registration, /lsp-status command
│   ├── types.ts                  # Shared type definitions: LspServerConfig, LspServerInstance, tool params
│   ├── types-global.d.ts         # Ambient type declarations for runtime dependencies (typebox, pi-coding-agent)
│   ├── lsp-manager.ts            # Server lifecycle: start/stop, idle timeout, file tracking, status
│   ├── lsp-client.ts             # JSON-RPC client over stdio — request/response/notification handling
│   ├── language-config.ts        # 33 language server configurations (command, args, install instructions)
│   ├── diagnostics.ts            # Auto-diagnostics hook triggered on write/edit tool completion
│   └── tools/
│       ├── shared.ts             # Shared tool utilities (position conversion, LSP request helpers)
│       ├── diagnostics.ts        # lsp_diagnostics tool registration
│       ├── find_references.ts    # find_references tool registration
│       ├── find_definition.ts    # find_definition tool registration
│       ├── find_symbols.ts       # find_symbols tool registration
│       ├── find_calls.ts         # find_calls tool registration
│       ├── rename_symbol.ts      # rename_symbol tool registration
│       ├── find_document_symbols.ts  # find_document_symbols tool registration
│       ├── hover.ts              # hover tool registration
│       ├── find_implementations.ts   # find_implementations tool registration
│       ├── find_type_definition.ts   # find_type_definition tool registration
│       └── find_type_hierarchy.ts    # find_type_hierarchy tool registration
│
├── tests/
│   ├── setup.ts                  # Vitest setup — mocks node:child_process globally
│   ├── helpers/
│   │   ├── fixtures.ts           # Shared test fixtures
│   │   ├── mock-extension-api.ts # Mock implementation of pi ExtensionAPI
│   │   └── mock-lsp-server.ts    # Mock LSP server for integration tests
│   ├── unit/
│   │   ├── diagnostics.test.ts   # Unit tests for diagnostics.ts
│   │   ├── language-config.test.ts # Unit tests for language-config.ts
│   │   ├── lsp-client.test.ts    # Unit tests for JSON-RPC client
│   │   ├── lsp-manager.test.ts   # Unit tests for server manager
│   │   └── shared.test.ts        # Unit tests for shared utilities
│   └── integration/
│       ├── tool-diagnostics.test.ts          # Integration: diagnostics tool
│       ├── tool-find-references.test.ts      # Integration: find references tool
│       ├── tool-find-definition.test.ts      # Integration: find definition tool
│       ├── tool-find-symbols.test.ts         # Integration: find symbols tool
│       ├── tool-find-calls.test.ts           # Integration: call hierarchy tool
│       ├── tool-rename-symbol.test.ts        # Integration: rename symbol tool
│       ├── tool-find-document-symbols.test.ts  # Integration: find document symbols tool
│       ├── tool-hover.test.ts                # Integration: hover tool
│       ├── tool-find-implementations.test.ts   # Integration: find implementations tool
│       ├── tool-find-type-definition.test.ts   # Integration: find type definition tool
│       └── tool-find-type-hierarchy.test.ts    # Integration: find type hierarchy tool
│
└── skills/
    └── scouting-and-debugging/SKILL.md  # pi skill describing LSP tool usage patterns
```

## TypeScript Configuration

`tsconfig.json` settings:

| Option | Value | Purpose |
|--------|-------|---------|
| `target` | `ES2020` | Emit modern JavaScript features |
| `module` | `ESNext` | ES module syntax with dynamic imports |
| `moduleResolution` | `node` | Node.js-style module resolution |
| `strict` | `true` | Enable all strict type-checking options |
| `esModuleInterop` | `true` | Compatibility with CommonJS default exports |
| `skipLibCheck` | `true` | Skip type-checking declaration files (faster) |
| `declaration` | `true` | Generate `.d.ts` files |
| `rootDir` | `./src` | Source root directory |
| `outDir` | `./dist` | Output directory (unused at runtime) |
| `types` | `["node"]` | Include `@types/node` declarations only |
| `ignoreDeprecations` | `"6.0"` | Suppress TypeScript 6.0 deprecation warnings |

The config includes `src/**/*` only — test files are handled separately by vitest.

## ESLint Configuration

The project uses ESLint's [flat config](https://eslint.org/docs/latest/use/configure/configuration-files-new) format (`eslint.config.mjs`), composed with `typescript-eslint`.

### Config Stack

1. **`@eslint/js` recommended** — base JS best practices
2. **`typescript-eslint` strict** — strict TypeScript rules
3. **`typescript-eslint` stylistic** — style consistency rules

### Key Custom Rules

| Rule | Level | Effect |
|------|-------|--------|
| `@typescript-eslint/no-misused-promises` | error | Catches promises passed where non-promise values are expected |
| `@typescript-eslint/no-floating-promises` | error | Requires all promises to be handled (awaited, caught, or voided) |
| `@typescript-eslint/require-await` | warn | Flags `async` functions without `await` |
| `@typescript-eslint/no-explicit-any` | warn | Discourages use of `any` type |
| `@typescript-eslint/no-unsafe-*` (assignment/call/member-access) | warn | Flags unsafe type operations when interacting with `any` |
| `@typescript-eslint/consistent-type-imports` | error | Enforces `import type` for type-only imports |
| `@typescript-eslint/prefer-nullish-coalescing` | error | Prefer `??` over `||` for nullish checks |
| `@typescript-eslint/prefer-optional-chain` | error | Prefer `?.` over manual null checks |
| `@typescript-eslint/no-unnecessary-condition` | error | Flags conditions that are always true/false |
| `@typescript-eslint/no-non-null-assertion` | warn | Discourages `!` non-null assertions |
| `@typescript-eslint/consistent-type-definitions` | error, `"interface"` | Enforces `interface` over `type` for object shapes |

Type-aware linting is enabled via `projectService: true`, which uses the project's `tsconfig.json` for semantic analysis.

## No Build Step

pi-lsp has **no build step**. The pi framework loads TypeScript source files directly at runtime via the entry point defined in `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Key implications:

- **The `outDir` (`./dist`) and `declaration` options in `tsconfig.json` are unused at runtime** — they exist only for type-checking and IDE support.
- **`typebox` is a runtime dependency of the pi framework**, not this extension. The ambient declarations in `src/types-global.d.ts` provide type stubs so the TypeScript compiler understands the `Type` API without importing the actual package. The extension never imports typebox directly — it is consumed by pi's tool registration pipeline.
- **`npm install` is still required** to pull in `vscode-languageserver-types` (used for `Diagnostic` and other LSP type imports) and all dev dependencies (TypeScript, ESLint, vitest).
- **Run `npm run typecheck` frequently** — since there is no compilation step, type errors will only surface at load time without explicit checking.
