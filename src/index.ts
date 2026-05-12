/**
 * pi-lsp: LSP Integration Extension for pi
 *
 * Features:
 * - Auto-diagnostics on file edit/write
 * - Auto-install LSP servers on first use
 * - 6 LSP tools: diagnostics, find-references, refactor-symbol,
 *                 goto-definition, find-symbol, call-hierarchy
 * - Persistent LSP servers with 5-min idle timeout
 * - 33 language LSP support
 *
 * Usage:
 *   Place in ~/.pi/agent/extensions/pi-lsp/ and run `npm install`
 *   Or test with: pi -e ./src/index.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LspManager } from "./lsp-manager.js";
import { LspClient } from "./lsp-client.js";
import { registerDiagnosticsHook } from "./diagnostics.js";
import {
  LANGUAGE_SERVERS,
  languageFromPath,
  isServerInstalled,
} from "./language-config.js";
import type { LspDiagnosticsParams, LspFindReferencesParams, LspRefactorSymbolParams, LspGotoDefinitionParams, LspFindSymbolParams, LspCallHierarchyParams } from "./types.js";

// Schema types for tools (using TypeBox)
const LspDiagnosticsSchema = Type.Object({
  file: Type.String({ description: "Path to the file to check" }),
  refresh: Type.Optional(Type.Boolean({ description: "Force refresh diagnostics from the server" })),
});

const LspFindReferencesSchema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

const LspRefactorSymbolSchema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
  newName: Type.String({ description: "New name for the symbol" }),
});

const LspGotoDefinitionSchema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

const LspFindSymbolSchema = Type.Object({
  query: Type.String({ description: "Fuzzy symbol name to search for" }),
});

const LspCallHierarchySchema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

// ── Extension Entry Point ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let manager: LspManager | null = null;
  let cwd = process.cwd();

  /** Resolve a file path relative to cwd */
  function resolveFile(file: string): string {
    return path.isAbsolute(file) ? file : path.resolve(cwd, file);
  }

  /** Ensure an LSP server is installed, prompting the user if needed */
  async function ensureServerInstalled(language: string, ui: any): Promise<boolean> {
    const config = LANGUAGE_SERVERS.find((c) => c.language === language);
    if (!config) return false;

    const installed = await isServerInstalled(config);
    if (installed) return true;

    const ok = await ui.confirm(
      `Install LSP server: ${language}`,
      `The ${language} language server is not installed.\n\nInstall command: ${config.installCommand}\n\nWould you like to install it now?`,
    );
    if (!ok) return false;

    ui.notify(`Installing ${language} LSP server...`, "info");

    const { exec } = await import("node:child_process");
    const result = await new Promise<{ success: boolean; output: string }>((resolve) => {
      exec(config.installCommand, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        resolve({ success: !error, output });
      });
    });

    if (!result.success) {
      ui.notify(`Failed to install ${language} LSP server: ${result.output}`, "error");
      return false;
    }

    ui.notify(`${language} LSP server installed successfully.`, "success");

    // Verify installation
    const verified = await isServerInstalled(config);
    if (!verified) {
      ui.notify(`Installation verification failed for ${language}. You may need to restart pi.`, "warning");
      return false;
    }

    return true;
  }

  /** Initialize the LSP manager (called on session_start) */
  function initManager() {
    if (manager) return;
    manager = new LspManager(cwd, 5 * 60 * 1000); // 5 min idle timeout

    // Register diagnostics hook
    registerDiagnosticsHook(pi, manager);
  }

  // ── Session Lifecycle ──────────────────────────────────────────────────

  pi.on("session_start", async (event, ctx) => {
    cwd = ctx.cwd;
    initManager();
    if (ctx.hasUI) {
      ctx.ui.notify("pi-lsp extension loaded", "info");
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // Stop all LSP servers on shutdown
    if (manager) {
      await manager.stopAll();
      manager = null;
    }
  });

  // ── Handle diagnostics notifications from LSP servers ──────────────────

  // We need to intercept the diagnostics notifications. Since our LSP client
  // handles notifications internally, we set up a way to expose them.
  // The LspClient will store diagnostics in the server instance automatically.

  // ── Register 6 LSP Tools ──────────────────────────────────────────────

  // Tool 1: lsp-diagnostics
  pi.registerTool({
    name: "lsp-diagnostics",
    label: "LSP Diagnostics",
    description: "Run LSP diagnostics on a file. Shows errors, warnings, and info messages. Use refresh=true to force a re-check.",
    promptSnippet: "Check a file for LSP diagnostics (errors, warnings)",
    promptGuidelines: [
      "Use lsp-diagnostics to check a specific file for compilation errors and warnings.",
      "Set refresh=true to force the LSP server to re-analyze the file.",
    ],
    parameters: LspDiagnosticsSchema,
    async execute(_toolCallId, params: LspDiagnosticsParams, _signal, _onUpdate, ctx) {
      if (!manager) initManager();
      const filePath = resolveFile(params.file);
      const config = languageFromPath(filePath);

      if (!config) {
        return {
          content: [{ type: "text", text: `No LSP server configured for "${params.file}".\n\nSupported languages: ${LANGUAGE_SERVERS.map((c) => c.language).join(", ")}` }],
          details: { file: params.file },
          isError: true,
        };
      }

      const installed = await isServerInstalled(config);
      if (!installed) {
        const available = await ensureServerInstalled(config.language, ctx.ui);
        if (!available) {
          return {
            content: [{ type: "text", text: `LSP server for ${config.language} is not installed.\n\nInstall: ${config.installCommand}` }],
            details: { file: params.file },
            isError: true,
          };
        }
      }

      try {
        const diagnostics = await manager!.getDiagnostics(filePath, params.refresh ?? false);
        const errorCount = diagnostics.filter((d) => d.severity === 1).length;
        const warningCount = diagnostics.filter((d) => d.severity === 2).length;
        const infoCount = diagnostics.filter((d) => d.severity === 3 || d.severity === 4).length;

        const lines = diagnostics.map((d) => {
          const startLine = d.range.start.line + 1;
          const startCol = d.range.start.character + 1;
          const severity = ["?", "Error", "Warning", "Info", "Hint"][d.severity ?? 0] ?? "?";
          const source = d.source ? `[${d.source}] ` : "";
          const code = d.code !== undefined ? ` (${d.code})` : "";
          return `  ${severity}: ${startLine}:${startCol}: ${source}${d.message}${code}`;
        });

        const summary = `Diagnostics for ${params.file} (${config.language}):\n` +
          `${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info message(s)\n\n` +
          (lines.length > 0 ? lines.join("\n") : "No issues found.");

        return {
          content: [{ type: "text", text: summary }],
          details: { file: params.file, language: config.language, errorCount, warningCount, infoCount, total: diagnostics.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to get diagnostics: ${(err as Error).message}` }],
          details: { file: params.file },
          isError: true,
        };
      }
    },
  });

  // Tool 2: lsp-find-references
  pi.registerTool({
    name: "lsp-find-references",
    label: "LSP Find References",
    description: "Find all references to the symbol at the given position in a file. Returns a list of locations where the symbol is used.",
    promptSnippet: "Find all references to a symbol in the codebase",
    promptGuidelines: [
      "Use lsp-find-references with file path, line, and column to find all references to a symbol.",
      "Line and column are 1-indexed.",
    ],
    parameters: LspFindReferencesSchema,
    async execute(_toolCallId, params: LspFindReferencesParams, _signal, _onUpdate, ctx) {
      if (!manager) initManager();
      const filePath = resolveFile(params.file);
      const config = languageFromPath(filePath);

      if (!config) {
        return {
          content: [{ type: "text", text: `No LSP server configured for "${params.file}".` }],
          details: {},
          isError: true,
        };
      }

      const installed = await isServerInstalled(config);
      if (!installed) {
        const available = await ensureServerInstalled(config.language, ctx.ui);
        if (!available) return { content: [{ type: "text", text: `LSP server for ${config.language} is not installed.` }], details: {}, isError: true };
      }

      try {
        const client = await manager!.getClientForConfig(config);
        if (!client) return { content: [{ type: "text", text: `Failed to start LSP server for ${config.language}.` }], details: {}, isError: true };

        const uri = pathToFileURL(filePath).href;
        await manager!.ensureFileOpen(client, config, filePath);

        const result = await client.findReferences(uri, params.line - 1, params.column - 1);
        const locations: { uri: string; line: number; col: number }[] = Array.isArray(result)
          ? result.map((loc: any) => ({
              uri: loc.uri,
              line: loc.range.start.line + 1,
              col: loc.range.start.character + 1,
            }))
          : [];

        const formatted = locations.length > 0
          ? locations.map((l) => `  ${decodeURIComponent(l.uri.replace(/^file:\/\//, ""))}:${l.line}:${l.col}`).join("\n")
          : "(none)";

        return {
          content: [{ type: "text", text: `References found: ${locations.length}\n\n${formatted}` }],
          details: { file: params.file, line: params.line, column: params.column, references: locations, count: locations.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to find references: ${(err as Error).message}` }],
          details: { file: params.file, line: params.line, column: params.column },
          isError: true,
        };
      }
    },
  });

  // Tool 3: lsp-refactor-symbol
  pi.registerTool({
    name: "lsp-refactor-symbol",
    label: "LSP Refactor Symbol",
    description: "Rename a symbol at the given position. Returns a unified diff patch that can be applied with the edit tool. Does NOT automatically apply changes.",
    promptSnippet: "Rename a symbol across the codebase (returns a patch to apply)",
    promptGuidelines: [
      "Use lsp-refactor-symbol to rename a symbol. It returns a patch — use the edit tool to apply it.",
      "Do not apply the patch automatically; show it to the user first.",
    ],
    parameters: LspRefactorSymbolSchema,
    async execute(_toolCallId, params: LspRefactorSymbolParams, _signal, _onUpdate, ctx) {
      if (!manager) initManager();
      const filePath = resolveFile(params.file);
      const config = languageFromPath(filePath);

      if (!config) {
        return { content: [{ type: "text", text: `No LSP server configured for "${params.file}".` }], details: {}, isError: true };
      }

      const installed = await isServerInstalled(config);
      if (!installed) {
        const available = await ensureServerInstalled(config.language, ctx.ui);
        if (!available) return { content: [{ type: "text", text: `LSP server for ${config.language} is not installed.` }], details: {}, isError: true };
      }

      try {
        const client = await manager!.getClientForConfig(config);
        if (!client) return { content: [{ type: "text", text: `Failed to start LSP server for ${config.language}.` }], details: {}, isError: true };

        const uri = pathToFileURL(filePath).href;
        await manager!.ensureFileOpen(client, config, filePath);

        // Try to get the current symbol name
        let oldName = "(unknown)";
        let renameRange: any = null;
        try {
          const prepareResult = await client.prepareRename(uri, params.line - 1, params.column - 1) as any;
          if (prepareResult && typeof prepareResult === "object") {
            if ("placeholder" in prepareResult) {
              oldName = prepareResult.placeholder;
              renameRange = prepareResult.range;
            } else if ("start" in prepareResult && "end" in prepareResult) {
              // prepareRename returned just a Range
              renameRange = prepareResult;
            }
          }
        } catch {
          // prepareRename not supported
        }

        // If we got a range but no placeholder, extract the text from the file
        if (oldName === "(unknown)" && renameRange) {
          try {
            const { readFileSync } = await import("node:fs");
            const content = readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const startLine = lines[renameRange.start.line] || "";
            const endLine = lines[renameRange.end.line] || "";
            if (renameRange.start.line === renameRange.end.line) {
              oldName = startLine.slice(renameRange.start.character, renameRange.end.character);
            } else {
              oldName = startLine.slice(renameRange.start.character) + "\n" + endLine.slice(0, renameRange.end.character);
            }
          } catch { /* ignore */ }
        }

        // Final fallback: extract word at cursor position
        if (oldName === "(unknown)") {
          try {
            const { readFileSync } = await import("node:fs");
            const content = readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const lineContent = lines[params.line - 1] || "";
            const col = params.column - 1;
            const before = lineContent.slice(0, col).match(/[\w$]+$/)?.[0] || "";
            const after = lineContent.slice(col).match(/^[\w$]+/)?.[0] || "";
            oldName = before + after || "(unknown)";
          } catch { /* ignore */ }
        }

        const workspaceEdit = (await client.rename(uri, params.line - 1, params.column - 1, params.newName)) as any;

        // Build patch — handle both `changes` and `documentChanges` formats
        const patchParts: string[] = [];
        let fileCount = 0;

        // Handle documentChanges format (LSP 3.17+)
        const docChanges = workspaceEdit?.documentChanges || [];
        for (const dc of docChanges) {
          if (dc.textDocument && dc.edits && Array.isArray(dc.edits)) {
            const changeUri = dc.textDocument.uri;
            const changePath = decodeURIComponent(changeUri.replace(/^file:\/\//, ""));
            const sorted = [...dc.edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
            fileCount++;
            try {
              const { readFileSync } = await import("node:fs");
              const original = readFileSync(changePath, "utf-8");
              const modified = applyEdits(original, sorted);
              patchParts.push(buildDiff(changePath, original, modified));
            } catch {
              const newText = sorted.map((e: any) => e.newText).join("");
              const lineCount = newText ? newText.split("\n").length : 0;
              patchParts.push(`--- /dev/null\n+++ ${changePath}\n@@ -0,0 +1,${lineCount} @@\n${newText.split("\n").map((l: string) => "+" + l).join("\n")}`);
            }
          }
        }

        // Handle legacy changes format
        const changes = workspaceEdit?.changes || {};
        for (const [changeUri, edits] of Object.entries(changes) as [string, any[]][]) {
          // Skip if already processed via documentChanges
          if (fileCount > 0 && docChanges.some((dc: any) => dc.textDocument?.uri === changeUri)) continue;
          const changePath = decodeURIComponent(changeUri.replace(/^file:\/\//, ""));
          const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
          fileCount++;
          try {
            const { readFileSync } = await import("node:fs");
            const original = readFileSync(changePath, "utf-8");
            const modified = applyEdits(original, sorted);
            patchParts.push(buildDiff(changePath, original, modified));
          } catch {
            const newText = sorted.map((e: any) => e.newText).join("");
            const lineCount = newText ? newText.split("\n").length : 0;
            patchParts.push(`--- /dev/null\n+++ ${changePath}\n@@ -0,0 +1,${lineCount} @@\n${newText.split("\n").map((l: string) => "+" + l).join("\n")}`);
          }
        }

        const patch = patchParts.join("\n\n") || "No changes generated.";

        return {
          content: [{
            type: "text",
            text: `Rename "${oldName}" → "${params.newName}"\nFile: ${params.file}\nFiles affected: ${fileCount}\n\nPatch:\n\`\`\`diff\n${patch}\n\`\`\`\n\nUse the edit tool to apply these changes.`,
          }],
          details: { file: params.file, oldName, newName: params.newName, patch, fileCount },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to refactor symbol: ${(err as Error).message}` }],
          details: { file: params.file },
          isError: true,
        };
      }
    },
  });

  // Tool 4: lsp-goto-definition
  pi.registerTool({
    name: "lsp-goto-definition",
    label: "LSP Go to Definition",
    description: "Find the definition of the symbol at the given position in a file.",
    promptSnippet: "Find where a symbol is defined",
    promptGuidelines: [
      "Use lsp-goto-definition with file path, line, and column to find a symbol's definition.",
      "Line and column are 1-indexed.",
    ],
    parameters: LspGotoDefinitionSchema,
    async execute(_toolCallId, params: LspGotoDefinitionParams, _signal, _onUpdate, ctx) {
      if (!manager) initManager();
      const filePath = resolveFile(params.file);
      const config = languageFromPath(filePath);

      if (!config) {
        return { content: [{ type: "text", text: `No LSP server configured for "${params.file}".` }], details: {}, isError: true };
      }

      const installed = await isServerInstalled(config);
      if (!installed) {
        const available = await ensureServerInstalled(config.language, ctx.ui);
        if (!available) return { content: [{ type: "text", text: `LSP server for ${config.language} is not installed.` }], details: {}, isError: true };
      }

      try {
        const client = await manager!.getClientForConfig(config);
        if (!client) return { content: [{ type: "text", text: `Failed to start LSP server for ${config.language}.` }], details: {}, isError: true };

        const uri = pathToFileURL(filePath).href;
        await manager!.ensureFileOpen(client, config, filePath);

        const result = await client.gotoDefinition(uri, params.line - 1, params.column - 1);
        let locations: { uri: string; line: number; col: number }[] = [];

        if (Array.isArray(result)) {
          locations = result.map((loc: any) => ({ uri: loc.uri, line: loc.range.start.line + 1, col: loc.range.start.character + 1 }));
        } else if (result && typeof result === "object" && "uri" in result) {
          locations = [{ uri: (result as any).uri, line: (result as any).range.start.line + 1, col: (result as any).range.start.character + 1 }];
        }

        const formatted = locations.length > 0
          ? locations.map((l) => `  ${decodeURIComponent(l.uri.replace(/^file:\/\//, ""))}:${l.line}:${l.col}`).join("\n")
          : "(none)";

        return {
          content: [{ type: "text", text: `Definition found: ${locations.length} location(s)\n\n${formatted}` }],
          details: { file: params.file, line: params.line, column: params.column, definitions: locations, count: locations.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to find definition: ${(err as Error).message}` }],
          details: { file: params.file },
          isError: true,
        };
      }
    },
  });

  // Tool 5: lsp-find-symbol
  pi.registerTool({
    name: "lsp-find-symbol",
    label: "LSP Find Symbol",
    description: "Search for symbols (functions, classes, variables, etc.) matching a fuzzy query across the workspace.",
    promptSnippet: "Search for symbols by name across the workspace",
    promptGuidelines: [
      "Use lsp-find-symbol to search for a symbol by name. It searches the entire workspace.",
    ],
    parameters: LspFindSymbolSchema,
    async execute(_toolCallId, params: LspFindSymbolParams, _signal, _onUpdate, ctx) {
      if (!manager) initManager();
      if (!params.query || params.query.length < 1) {
        return { content: [{ type: "text", text: "Please provide a symbol query to search for." }], details: {}, isError: true };
      }

      // Find a running server or start one based on workspace files
      let client: LspClient | null = null;
      let config: any = null;

      for (const serverConfig of LANGUAGE_SERVERS) {
        const c = manager!.getClientMap().get(serverConfig.language);
        if (c) {
          client = c;
          config = serverConfig;
          break;
        }
      }

      if (!client) {
        // Try to find a source file to determine language
        const { execSync } = await import("node:child_process");
        try {
          const files = execSync(`find "${cwd}" -maxdepth 3 -type f \\( -name "*.ts" -o -name "*.py" -o -name "*.js" -o -name "*.rs" -o -name "*.go" -o -name "*.java" \\) 2>/dev/null | head -1`, { encoding: "utf-8", timeout: 5000 }).trim();
          if (files) {
            config = languageFromPath(files);
            if (config) {
              const installed = await isServerInstalled(config);
              if (!installed) {
                const available = await ensureServerInstalled(config.language, ctx.ui);
                if (!available) return { content: [{ type: "text", text: `LSP server for ${config.language} is not installed.` }], details: {}, isError: true };
              }
              client = await manager!.getClientForConfig(config);
            }
          }
        } catch { /* no source files */ }
      }

      if (!client) {
        return { content: [{ type: "text", text: "No LSP server running. Edit a file first to start an LSP server." }], details: {}, isError: true };
      }

      try {
        const result = await client.workspaceSymbol(params.query) as any[];
        const symbols = Array.isArray(result) ? result : [];

        if (symbols.length === 0) {
          return { content: [{ type: "text", text: `No symbols found matching "${params.query}".` }], details: { query: params.query, count: 0 } };
        }

        const KIND_NAMES: Record<number, string> = {
          1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
          6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
          11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
          15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
          20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
          25: "Operator", 26: "TypeParameter",
        };

        const formatted = symbols.slice(0, 50).map((s: any) => {
          const name = s.name || "(unknown)";
          const kind = s.kind !== undefined ? (KIND_NAMES[s.kind] || `Kind(${s.kind})`) : "";
          const uri = s.location?.uri || "";
          const filePath = decodeURIComponent(uri.replace(/^file:\/\//, ""));
          const line = s.location?.range?.start?.line ? s.location.range.start.line + 1 : "?";
          const container = s.containerName ? ` [${s.containerName}]` : "";
          return `  ${name}${container} (${kind}) — ${filePath}:${line}`;
        }).join("\n");

        const more = symbols.length > 50 ? `\n  ... and ${symbols.length - 50} more` : "";

        return {
          content: [{ type: "text", text: `Symbols matching "${params.query}": ${symbols.length}\n\n${formatted}${more}` }],
          details: {
            query: params.query,
            count: symbols.length,
            symbols: symbols.slice(0, 50).map((s: any) => ({
              name: s.name,
              kind: KIND_NAMES[s.kind] || "",
              uri: s.location?.uri || "",
              line: s.location?.range?.start?.line ? s.location.range.start.line + 1 : 0,
            })),
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to find symbols: ${(err as Error).message}` }],
          details: { query: params.query },
          isError: true,
        };
      }
    },
  });

  // Tool 6: lsp-call-hierarchy
  pi.registerTool({
    name: "lsp-call-hierarchy",
    label: "LSP Call Hierarchy",
    description: "List call hierarchies for a function at the given position. Shows incoming calls (who calls this) and outgoing calls (what this calls).",
    promptSnippet: "Show what calls a function and what it calls",
    promptGuidelines: [
      "Use lsp-call-hierarchy with file path, line, and column on a function/method to see its callers and callees.",
      "Line and column are 1-indexed.",
    ],
    parameters: LspCallHierarchySchema,
    async execute(_toolCallId, params: LspCallHierarchyParams, _signal, _onUpdate, ctx) {
      if (!manager) initManager();
      const filePath = resolveFile(params.file);
      const config = languageFromPath(filePath);

      if (!config) {
        return { content: [{ type: "text", text: `No LSP server configured for "${params.file}".` }], details: {}, isError: true };
      }

      const installed = await isServerInstalled(config);
      if (!installed) {
        const available = await ensureServerInstalled(config.language, ctx.ui);
        if (!available) return { content: [{ type: "text", text: `LSP server for ${config.language} is not installed.` }], details: {}, isError: true };
      }

      try {
        const client = await manager!.getClientForConfig(config);
        if (!client) return { content: [{ type: "text", text: `Failed to start LSP server for ${config.language}.` }], details: {}, isError: true };

        const uri = pathToFileURL(filePath).href;
        await manager!.ensureFileOpen(client, config, filePath);

        const prepareResult = await client.prepareCallHierarchy(uri, params.line - 1, params.column - 1) as any[];
        const items = Array.isArray(prepareResult) ? prepareResult : (prepareResult ? [prepareResult] : []);

        if (items.length === 0) {
          return { content: [{ type: "text", text: "No call hierarchy available at this position. Place cursor on a function/method name." }], details: { file: params.file } };
        }

        const item = items[0];
        let incomingCalls: any[] = [];
        let outgoingCalls: any[] = [];

        try {
          const incoming = await client.incomingCalls(item);
          incomingCalls = Array.isArray(incoming) ? incoming : [];
        } catch { /* not supported */ }

        try {
          const outgoing = await client.outgoingCalls(item);
          outgoingCalls = Array.isArray(outgoing) ? outgoing : [];
        } catch { /* not supported */ }

        const formatCall = (call: any, direction: "from" | "to") => {
          const node = call[direction];
          const name = node?.name || "(unknown)";
          const uri = node?.uri || "";
          const fp = decodeURIComponent(uri.replace(/^file:\/\//, ""));
          const line = node?.range?.start?.line ? node.range.start.line + 1 : "?";
          const ranges = (call.fromRanges || []).map((r: any) => `    at line ${r.start.line + 1}`).join("\n");
          return `  ${name} — ${fp}:${line}\n${ranges}`;
        };

        let output = `Call hierarchy for "${item.name}" in ${params.file}:${params.line}:${params.column}\n`;

        if (incomingCalls.length > 0) {
          output += `\n─── Incoming Calls (${incomingCalls.length}) ───\n`;
          output += incomingCalls.map((c) => formatCall(c, "from")).join("\n\n");
        }

        if (outgoingCalls.length > 0) {
          output += `\n─── Outgoing Calls (${outgoingCalls.length}) ───\n`;
          output += outgoingCalls.map((c) => formatCall(c, "to")).join("\n\n");
        }

        if (incomingCalls.length === 0 && outgoingCalls.length === 0) {
          output += "\nNo incoming or outgoing calls found.";
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            file: params.file,
            line: params.line,
            column: params.column,
            functionName: item.name,
            incomingCount: incomingCalls.length,
            outgoingCount: outgoingCalls.length,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to get call hierarchy: ${(err as Error).message}` }],
          details: { file: params.file },
          isError: true,
        };
      }
    },
  });

  // ── Diagnostics notifications from LSP servers ─────────────────────────
  // Since our LSP client stores diagnostics in the server instance,
  // we periodically check and notify about new diagnostics.

  // Set up notification handler on the client's message processing
  // by hooking into the manager's diagnostic storage

  // We also add a /lsp-status command
  pi.registerCommand("lsp-status", {
    description: "Show status of all LSP servers",
    handler: async (_args, ctx) => {
      if (!manager) {
        ctx.ui.notify("LSP manager not initialized. Edit a file first.", "info");
        return;
      }

      const status = manager.getStatus();
      if (status.length === 0) {
        ctx.ui.notify("No LSP servers running.", "info");
        return;
      }

      const lines = status.map((s) => `${s.language}: ${s.status} (pid: ${s.pid})`);
      ctx.ui.notify(`LSP Servers:\n${lines.join("\n")}`, "info");
    },
  });
}

// ── Helper Functions (duplicated from tools.ts to avoid cross-module deps) ──

function applyEdits(text: string, edits: any[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });

  const lines = text.split("\n");
  for (const edit of sorted) {
    const { start, end } = edit.range;
    const prefix = (lines[start.line] || "").slice(0, start.character);
    const suffix = (lines[end.line] || "").slice(end.character);
    const newContent = prefix + edit.newText + suffix;
    const newLinesArr = newContent.split("\n");

    const newArr = [
      ...(start.line > 0 ? lines.slice(0, start.line) : []),
      ...newLinesArr,
      ...(end.line + 1 < lines.length ? lines.slice(end.line + 1) : []),
    ];

    lines.length = 0;
    lines.push(...newArr);
  }

  return lines.join("\n");
}

function buildDiff(filePath: string, original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const hunkLines: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  let hasChanges = false;

  const maxLines = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLines; i++) {
    const orig = i < origLines.length ? origLines[i] : undefined;
    const mod = i < modLines.length ? modLines[i] : undefined;

    if (orig === mod) {
      if (hasChanges) {
        hunkLines.push(` ${orig ?? ""}`);
        oldLine++;
        newLine++;
      } else {
        oldLine++;
        newLine++;
      }
    } else {
      if (!hasChanges) {
        hunkLines.push(`@@ -${oldLine},${Math.max(origLines.length - oldLine + 1, 1)} +${newLine},${Math.max(modLines.length - newLine + 1, 1)} @@`);
      }
      hasChanges = true;
      if (orig !== undefined) {
        hunkLines.push(`-${orig}`);
        oldLine++;
      }
      if (mod !== undefined) {
        hunkLines.push(`+${mod}`);
        newLine++;
      }
    }
  }

  if (hunkLines.length === 0) {
    hunkLines.push(`@@ -0,0 +0,0 @@\n (no changes)`);
  }

  return `--- a/${filePath}\n+++ b/${filePath}\n${hunkLines.join("\n")}`;
}
