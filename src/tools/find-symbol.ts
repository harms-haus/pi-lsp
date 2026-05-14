/**
 * lsp_find_symbol tool: Search for symbols across the workspace
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import type { LspClient } from "../lsp-client.js";
import {
  toolError,
  uriToFilePath,
  ensureServerInstalled,
  SYMBOL_KIND_NAMES,
  MAX_SYMBOL_RESULTS,
} from "./shared.js";
import { LANGUAGE_SERVERS, languageFromPath, isServerInstalled } from "../language-config.js";

const Schema = Type.Object({
  query: Type.String({ description: "Fuzzy symbol name to search for" }),
});

export function registerFindSymbolTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "lsp_find_symbol",
    label: "LSP Find Symbol",
    description: "Search for symbols (functions, classes, variables, etc.) matching a fuzzy query across the workspace.",
    promptSnippet: "Search for symbols by name across the workspace",
    promptGuidelines: [
      "Use lsp_find_symbol to search for a symbol by name. It searches the entire workspace.",
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
        const { execFileSync } = await import("node:child_process");
        try {
                    const files = execFileSync(
            "find",
            [
              cwd, "-maxdepth", "3", "-type", "f",
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

        if (symbols.length === 0) {
          return { content: [{ type: "text", text: `No symbols found matching "${params.query}".` }], details: { query: params.query, count: 0 } };
        }

        const formatted = symbols.slice(0, MAX_SYMBOL_RESULTS).map((s) => {
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

        const more = symbols.length > MAX_SYMBOL_RESULTS ? `\n  ... and ${symbols.length - MAX_SYMBOL_RESULTS} more` : "";

        return {
          content: [{ type: "text", text: `Symbols matching "${params.query}": ${symbols.length}\n\n${formatted}${more}` }],
          details: {
            query: params.query,
            count: symbols.length,
            symbols: symbols.slice(0, MAX_SYMBOL_RESULTS).map((s) => {
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
        return toolError(`Failed to find symbols: ${(err as Error).message}`, { query: params.query });
      }
    },
  });
}
