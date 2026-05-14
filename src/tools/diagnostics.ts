/**
 * lsp_diagnostics tool: Run LSP diagnostics on a file
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import {
  executePreamble,
  toolError,
  SEVERITY_NAMES,
} from "./shared.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file to check" }),
  refresh: Type.Optional(Type.Boolean({ description: "Force refresh diagnostics from the server" })),
});

export function registerDiagnosticsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "lsp_diagnostics",
    label: "LSP Diagnostics",
    description: "Run LSP diagnostics on a file. Shows errors, warnings, and info messages. Use refresh=true to force a re-check.",
    promptSnippet: "Check a file for LSP diagnostics (errors, warnings)",
    promptGuidelines: [
      "Use lsp_diagnostics to check a specific file for compilation errors and warnings.",
      "Set refresh=true to force the LSP server to re-analyze the file.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { filePath, config, manager } = preamble.ok;

      try {
        const diagnostics = await manager.getDiagnostics(filePath, params.refresh ?? false);
        const errorCount = diagnostics.filter((d) => d.severity === 1).length;
        const warningCount = diagnostics.filter((d) => d.severity === 2).length;
        const infoCount = diagnostics.filter((d) => d.severity === 3 || d.severity === 4).length;

        const lines = diagnostics.map((d) => {
          const startLine = d.range.start.line + 1;
          const startCol = d.range.start.character + 1;
          const severity = SEVERITY_NAMES[d.severity ?? 0] ?? "?";
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
        return toolError(`Failed to get diagnostics: ${(err as Error).message}`, { file: params.file });
      }
    },
  });
}
