# Adding Language Server Support

This guide explains how to add support for a new language to pi-lsp. All language server configurations live in `src/language-config.ts` as entries in the `LANGUAGE_SERVERS` array.

## Overview

pi-lsp ships with **33 preconfigured language servers**. Each language is defined by a single `LspServerConfig` object (see [Interface Reference](#lspserverconfig-interface) below) in the `LANGUAGE_SERVERS` array in [`src/language-config.ts`](../src/language-config.ts). When a tool operates on a file, the system:

1. Extracts the file extension via `languageFromPath()`
2. Looks up the matching `LspServerConfig` by extension
3. Checks if the server binary is installed via `isServerInstalled()` (runs `detectCommand`)
4. If not installed, prompts the user to auto-install via `ensureServerInstalled()`
5. Spawns the server process using `command` + `args` over stdio

No separate plugin system or dynamic loader exists — adding a language means adding one object to the array.

## LspServerConfig Interface

Every language entry conforms to the `LspServerConfig` interface defined in [`src/types.ts`](../src/types.ts):

| Field | Type | Required | Purpose |
|---|---|---|---|
| `language` | `string` | Yes | Human-readable language identifier (e.g. `"typescript"`, `"python"`). Used as the key for server instance management and user-facing messages. |
| `command` | `string` | Yes | The executable to spawn as the LSP server process (`argv[0]`). Must be on `$PATH` or use an absolute path. |
| `args` | `string[]` | Yes | Additional arguments passed to the command. **Must include `--stdio` or equivalent if the server requires it** — pi-lsp communicates exclusively over stdio. Use `[]` if the server defaults to stdio. |
| `extensions` | `string[]` | Yes | File extensions (with leading dot) that this server handles. Used by `languageFromPath()` to match files to servers. Can also include bare filenames (e.g. `"Dockerfile"`). |
| `detectCommand` | `string` | Yes | Shell command executed to check if the server is installed. If the command exits with code 0, the server is considered installed. Run with a **10-second timeout**. |
| `installCommand` | `string` | Yes | Shell command that installs the server. Shown to the user during auto-install and executed with a **5-minute timeout** and a 10 MB output buffer. |
| `installInstructions` | `string` | Yes | Human-readable installation instructions shown when auto-install is declined or fails. |
| `initializationOptions` | `Record<string, unknown>` | No | Arbitrary JSON sent as `initializationOptions` in the LSP `initialize` request. Omit if not needed. |

### Example: Complete `LspServerConfig` Entry

```ts
{
  language: "python",
  command: "pylsp",
  args: [],
  extensions: [".py"],
  detectCommand: "pylsp --version",
  installCommand: "pip install python-lsp-server",
  installInstructions: "pip install python-lsp-server",
}
```

### Example: With `initializationOptions`

```ts
{
  language: "mylang",
  command: "mylang-lsp",
  args: ["--stdio"],
  extensions: [".ml"],
  initializationOptions: {
    settings: {
      maxNumberOfProblems: 100,
    },
  },
  detectCommand: "mylang-lsp --version",
  installCommand: "npm install -g mylang-lsp",
  installInstructions: "npm install -g mylang-lsp",
}
```

## Step-by-Step: Adding a New Language

1. **Open `src/language-config.ts`**

2. **Add a new `LspServerConfig` object** to the `LANGUAGE_SERVERS` array. Use a comment divider (e.g. `// ── MyLang ──`) to keep the file organized:

   ```ts
   // ── MyLang ─────────────────────────────────────────────────────────────
   {
     language: "mylang",
     command: "mylang-lsp",
     args: ["--stdio"],
     extensions: [".ml"],
     detectCommand: "mylang-lsp --version",
     installCommand: "npm install -g mylang-lsp",
     installInstructions: "npm install -g mylang-lsp",
   },
   ```

3. **Set `args` correctly** — many servers require an explicit flag to use stdio (commonly `--stdio`, `stdio`, or `start`). Check the server's documentation. If the server defaults to stdio, use `[]`.

4. **Set `detectCommand`** — this must be a command that exits `0` when installed and non-zero when not. The usual pattern is `<command> --version` or `<command> version`.

5. **Set `installCommand`** — this is executed as a shell command during auto-install. It must be a single command line. If installation requires multiple steps or manual intervention, write a human-readable message and set `installInstructions` accordingly.

6. **Set `extensions`** — include all relevant file extensions with leading dots. If the server handles files without extensions (e.g. `Dockerfile`, `Makefile`), include the bare filename as a string in the array.

7. **Restart the pi session** so the new config is loaded (no build step required — pi loads TypeScript source directly):

   ```sh
   # No build step needed. Simply restart pi or start a new session.
   ```

8. **Test** by opening a file with the new extension and invoking an LSP tool. The system should auto-detect the language, check for installation, and prompt to install if needed.

## Current Languages

All 33 languages currently configured in `LANGUAGE_SERVERS`:

| Language | Command | Extensions | Install Method |
|---|---|---|---|
| typescript | `typescript-language-server` | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` | npm |
| python | `pylsp` | `.py` | pip |
| rust | `rust-analyzer` | `.rs` | rustup |
| go | `gopls` | `.go` | go install |
| java | `java` | `.java` | manual (Eclipse JDT LS) |
| cpp | `clangd` | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx` | apt / brew |
| csharp | `OmniSharp` | `.cs` | dotnet tool |
| php | `intelephense` | `.php` | npm |
| ruby | `ruby-lsp` | `.rb` | gem |
| lua | `lua-language-server` | `.lua` | npm |
| html | `html-languageserver` | `.html`, `.htm` | npm |
| css | `css-languageserver` | `.css`, `.scss`, `.less` | npm |
| json | `json-languageserver` | `.json`, `.jsonc` | npm |
| yaml | `yaml-language-server` | `.yaml`, `.yml` | npm |
| markdown | `markdown-language-server` | `.md` | npm |
| dart | `dart` | `.dart` | Dart SDK |
| kotlin | `kotlin-language-server` | `.kt`, `.kts` | manual (GitHub) |
| swift | `sourcekit-lsp` | `.swift` | Swift toolchain |
| zig | `zls` | `.zig` | manual (GitHub) |
| haskell | `haskell-language-server` | `.hs`, `.lhs` | ghcup |
| ocaml | `ocamllsp` | `.ml`, `.mli` | opam |
| elixir | `elixir-ls` | `.ex`, `.exs` | manual (GitHub) |
| scala | `metals` | `.scala`, `.sbt` | coursier |
| terraform | `terraform-ls` | `.tf`, `.tfvars`, `.hcl` | manual (GitHub) |
| dockerfile | `dockerfile-language-server-nodejs` | `.dockerfile`, `Dockerfile` | npm |
| sql | `sql-language-server` | `.sql` | npm |
| vue | `vue-language-server` | `.vue` | npm |
| svelte | `svelteserver` | `.svelte` | npm |
| toml | `taplo` | `.toml` | npm / cargo |
| nix | `nil` | `.nix` | nix / cargo |
| latex | `texlab` | `.tex`, `.latex` | cargo |
| r | `R` | `.r`, `.R` | R packages |
| bash | `bash-language-server` | `.sh`, `.bash` | npm |

> **Warning (Dockerfile):** The `command` field is set to `dockerfile-language-server-nodejs`, but the npm package of that name installs a binary called `docker-langserver`. The `detectCommand` correctly uses `docker-langserver --version`, so the mismatch will cause the server to fail to start (spawn `ENOENT`). See [Caveats: Command vs. install binary mismatch](#command-vs-install-binary-mismatch) for details.

## File Extension Detection

The `languageFromPath()` function in [`src/language-config.ts`](../src/language-config.ts) determines which `LspServerConfig` applies to a given file:

```ts
export function languageFromPath(filePath: string): LspServerConfig | undefined {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return undefined;
  const ext = filePath.slice(dotIndex);
  return getConfigForExtension(ext);
}
```

### How it works

1. Finds the **last** `.` in the file path via `lastIndexOf(".")`
2. Extracts everything from that `.` to the end as the extension (e.g. `"/path/to/file.ts"` → `".ts"`)
3. Calls `getConfigForExtension(ext)` which searches `LANGUAGE_SERVERS` for the first entry whose `extensions` array includes that string
4. Returns the first matching config, or `undefined` if no match

### Edge cases

| Scenario | Behavior |
|---|---|
| File with no extension (e.g. `Makefile`) | Returns `undefined` — the `.` search fails |
| Dotfiles (e.g. `.bashrc`) | Treated as extension `".bashrc"` — matches only if explicitly listed |
| Double extensions (e.g. `test.spec.ts`) | Uses last segment → `".ts"` |
| `Dockerfile` (bare name, no dot) | Listed as `"Dockerfile"` in `extensions`, but **will not be matched** by `languageFromPath()` since it looks for a `.` |
| Multiple servers sharing an extension | First entry in `LANGUAGE_SERVERS` wins (`.find()` returns first match) |

> **Note:** Extensionless files (e.g. `Dockerfile`, `Makefile`) are **not supported** by the current matching logic. `languageFromPath()` returns `undefined` for any path without a `.` character, so bare filenames in `extensions` arrays are **dead code that can never match**. The `"Dockerfile"` string in the Dockerfile entry's `extensions` array will never be reached. To support extensionless files, `languageFromPath()` would need to be modified to also check the basename of the file.

## Install Detection and Auto-Install

### Detection: `isServerInstalled()`

Defined in [`src/language-config.ts`](../src/language-config.ts):

```ts
export async function isServerInstalled(config: LspServerConfig): Promise<boolean>
```

- Executes `config.detectCommand` via `child_process.exec`
- **10-second timeout** — if the command takes longer, it is considered not installed
- Returns `true` if exit code is 0, `false` otherwise
- Catches any exceptions (e.g. command not found) and returns `false`

### Auto-Install: `ensureServerInstalled()`

Defined in [`src/tools/shared.ts`](../src/tools/shared.ts):

```ts
export async function ensureServerInstalled(
  language: string,
  ui: ToolUI,
): Promise<boolean>
```

The flow:

1. **Lookup** — finds the `LspServerConfig` by `language` name. Returns `false` if not found.
2. **Check** — calls `isServerInstalled(config)`. Returns `true` if already installed.
3. **Prompt** — calls `ui.confirm()` asking the user whether to install. Shows the `installCommand` in the prompt. Returns `false` if user declines.
4. **Install** — runs `config.installCommand` via `child_process.exec` with a **5-minute timeout** (300,000 ms) and a **10 MB output buffer**.
5. **Notify** — reports success or failure via `ui.notify()`.
6. **Verify** — calls `isServerInstalled(config)` again to confirm the installation actually worked. If verification fails, warns the user that a restart may be needed.

### When auto-install is triggered

The `executePreamble()` function (used by all file-based LSP tools) runs the check:

```ts
const installed = await isServerInstalled(config);
if (!installed) {
  const available = await ensureServerInstalled(config.language, ui);
  if (!available) {
    // abort tool execution
  }
}
```

This means auto-install is triggered **on first use** of any LSP tool on a file whose server is not yet installed.

## Caveats

### Stdio only

pi-lsp communicates with LSP servers exclusively over **stdio** (stdin/stdout). TCP and socket transports are not supported. Ensure the server you configure supports stdio mode and set `args` accordingly.

### Project configuration requirements

Some language servers require project-level configuration files to function correctly (e.g. `tsconfig.json` for TypeScript, `Cargo.toml` for Rust, `go.mod` for Go). pi-lsp does not create or manage these — they must already exist in the project.

### Java: hardcoded paths

The Java entry uses Eclipse JDT Language Server with **hardcoded Linux paths**:

```ts
args: [
  // ...
  "-jar", "/opt/jdt-language-server/plugins/org.eclipse.equinox.launcher_*.jar",
  "-configuration", "/opt/jdt-language-server/config_linux",
  "-data", "/tmp/jdt-workspace",
],
```

This assumes:
- JDT LS is installed at `/opt/jdt-language-server/`
- The config directory is `config_linux`
- A workspace directory at `/tmp/jdt-workspace` is acceptable

To use Java on a different OS or installation path, edit the `args` array directly. The glob pattern `*.jar` in the path is passed literally to Java — the shell does not expand it; Java's launcher handles it.

### Detect command reliability

`detectCommand` runs in a shell context. If your server's `--version` flag writes to stderr instead of stdout, `exec` still captures it and the exit code is what matters. However, if the command hangs indefinitely (no timeout from the server itself), the 10-second timeout will fire. Choose a fast, reliable detection command.

### Install command limitations

`installCommand` is a single shell command string, not a script. It cannot contain interactive prompts. If a package manager requires confirmation flags (e.g. `npm -y`, `apt -y`), include them in the command string. The 5-minute timeout is generous but may not be sufficient for slow networks or large compilations.

### Command vs. install binary mismatch

The `command` field in an `LspServerConfig` entry should be the actual executable name that gets spawned as the LSP server. Some npm packages install binaries under a name different from the package name itself. For example, the `dockerfile-language-server-nodejs` npm package installs a binary called `docker-langserver`, but the config's `command` field is set to `dockerfile-language-server-nodejs`. Since `detectCommand` uses `docker-langserver --version` (the correct binary), the server will pass the installation check but then fail to spawn with `ENOENT`.

To verify the correct command name for an npm-installed language server, check the `bin` field in the package's `package.json` or run `npm bin` after global installation.
