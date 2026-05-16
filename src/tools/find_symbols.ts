/**
 * find_symbols tool: Search for symbols across the workspace
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import type { LspClient } from "../lsp-client-methods.js";
import {
  ensureServerInstalled,
} from "./preamble.js";
import {
  MAX_SYMBOL_RESULTS,
} from "./shared.js";
import { toolError, parseSymbolKind, SYMBOL_KIND_NAMES, sanitizeError } from "./formatting.js";
import { uriToFilePath } from "./paths.js";
import * as fs from "node:fs";
import { LANGUAGE_SERVERS, languageFromPath, isServerInstalled } from "../language-config.js";

const Schema = Type.Object({
  query: Type.String({ description: "Fuzzy symbol name to search for" }),
  kind: Type.Optional(Type.String({ description: "Filter by symbol kind (e.g. \"class\", \"function\", \"interface\", \"enum\"). Case-insensitive." })),
});

export function registerFindSymbolsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "find_symbols",
    label: "Find Symbols",
    description: "Search for symbols (functions, classes, variables, etc.) matching a fuzzy query across the workspace. Optionally filter by symbol kind (e.g., \"class\", \"function\", \"interface\").",
    promptSnippet: "Search for symbols by name and kind across the workspace",
    promptGuidelines: [
      "Use find_symbols to search for a symbol by name across the entire workspace.",
      "Optionally provide a kind parameter (e.g. \"class\", \"function\", \"interface\", \"enum\") to filter results by symbol type.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const manager = getManager();
      if (!manager) {
        return toolError("LSP manager not initialized. Start a session first.");
      }

      const cwd = getCwd();

      if (!params.query || params.query.length < 1) {
        return toolError("Please provide a symbol query to search for.");
      }

      // Prefer TypeScript server (best workspace symbol support)
      let client: LspClient | null = null;

      const tsConfig = LANGUAGE_SERVERS.find((c) => c.language === "typescript");
      if (tsConfig) {
        const installed = await isServerInstalled(tsConfig);
        if (installed) {
          client = await manager.getClientForConfig(tsConfig);
        }
      }

      // Fall back to any running server
      if (!client) {
        for (const serverConfig of LANGUAGE_SERVERS) {
          const c = manager.getClientMap().get(serverConfig.language);
          if (c) {
            client = c;
            break;
          }
        }
      }

      // Start a new server based on workspace files
      if (!client) {
        // Validate cwd is a real directory
        let realCwd: string;
        try {
          realCwd = fs.realpathSync(cwd);
          const stat = fs.statSync(realCwd);
          if (!stat.isDirectory()) {
            return toolError("Workspace directory is not a valid directory.");
          }
        } catch {
          return toolError("Workspace directory does not exist or is not accessible.");
        }

        const { execFileSync } = await import("node:child_process");
        try {
                    const files = execFileSync(
            "find",
            [
              realCwd, "-maxdepth", "3", "-type", "f",
              "(", "-name", "*.ts", "-o", "-name", "*.py",
              "-o", "-name", "*.js", "-o", "-name", "*.rs",
              "-o", "-name", "*.go", "-o", "-name", "*.java", ")",
            ],
            { encoding: "utf-8", timeout: 5000 },
          ).trim().split("\n")[0];
          if (files) {
            const config = languageFromPath(files);
            if (config) {
              const installed = await isServerInstalled(config);
              if (!installed) {
                const available = await ensureServerInstalled(config.language, ctx.ui);
                if (!available) return toolError(`LSP server for ${config.language} is not installed.`);
              }
              client = await manager.getClientForConfig(config);
            }
          }
        } catch { /* no source files found */ }
      }

      if (!client) {
        return toolError("No LSP server running. Edit a file first to start an LSP server.");
      }

      try {
        const result = await client.workspaceSymbol(params.query);
        const symbols = Array.isArray(result) ? result : [];

        let filtered = symbols;
        let kindWarning: string | undefined;
        if (params.kind) {
          const kindNum = parseSymbolKind(params.kind);
          if (kindNum !== undefined) {
            filtered = symbols.filter(s => s.kind === kindNum);
          } else {
            kindWarning = `"${params.kind}" is not a valid symbol kind. Showing all results.`;
          }
        }

        if (filtered.length === 0) {
          return { content: [{ type: "text", text: `No symbols found matching "${params.query}".` }], details: { query: params.query, kind: params.kind, count: 0 } };
        }

        const formatted = filtered.slice(0, MAX_SYMBOL_RESULTS).map((s) => {
          const name = s.name || "(unknown)";
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP symbol kind can be outside known values
          const kind = s.kind !== undefined ? (SYMBOL_KIND_NAMES[s.kind] || `Kind(${s.kind})`) : "";
          const location = s.location;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP symbol location is loosely typed, need runtime checks
          const uri = typeof location === "object" && location !== null && "uri" in location ? location.uri : "";
          const filePath = uriToFilePath(uri);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP symbol location is loosely typed, need runtime checks
          const line = typeof location === "object" && location !== null && "range" in location && location.range?.start?.line !== undefined ? location.range.start.line + 1 : "?";
          const container = s.containerName ? ` [${s.containerName}]` : "";
          return `  ${name}${container} (${kind}) — ${filePath}:${line}`;
        }).join("\n");

        const more = filtered.length > MAX_SYMBOL_RESULTS ? `\n  ... and ${filtered.length - MAX_SYMBOL_RESULTS} more` : "";

        const suffix = kindWarning ? ` — ${kindWarning}` : "";
        const countLabel = params.kind
          ? `Symbols matching "${params.query}" (kind: ${params.kind}): ${filtered.length}${suffix}`
          : `Symbols matching "${params.query}": ${filtered.length}`;

        return {
          content: [{ type: "text", text: `${countLabel}\n\n${formatted}${more}` }],
          details: {
            query: params.query,
            kind: params.kind,
            count: filtered.length,
            symbols: filtered.slice(0, MAX_SYMBOL_RESULTS).map((s) => {
              const location = s.location;
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP symbol location is loosely typed, need runtime checks
              const uri = typeof location === "object" && location !== null && "uri" in location ? location.uri : "";
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP symbol location is loosely typed, need runtime checks
              const line = typeof location === "object" && location !== null && "range" in location && location.range?.start?.line !== undefined ? location.range.start.line + 1 : 0;
              return {
                name: s.name,
                kind: SYMBOL_KIND_NAMES[s.kind] || "",
                uri,
                line,
              };
            }),
          },
        };
      } catch (err) {
        return toolError(sanitizeError(err, "Failed to find symbols"), { query: params.query });
      }
    },
  });
}
