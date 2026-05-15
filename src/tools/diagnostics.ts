/**
 * lsp_diagnostics tool: Run LSP diagnostics on a file
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import {
  executePreamble,
  toolError,
  uriToFilePath,
  SEVERITY_NAMES,
  sanitizeError,
} from "./shared.js";

const Schema = Type.Object({
  file: Type.Optional(Type.String({ description: "Path to the file to check" })),
  workspace: Type.Optional(Type.Boolean({ description: "Scan all open files across all running LSP servers for errors" })),
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
    description: "Run LSP diagnostics on a file or scan the entire workspace for errors. Use refresh=true to force re-analysis. Use workspace=true to check all open files.",
    promptSnippet: "Check a file or workspace for LSP diagnostics (errors, warnings)",
    promptGuidelines: [
      "Use lsp_diagnostics to check a specific file for compilation errors and warnings.",
      "Set refresh=true to force the LSP server to re-analyze the file.",
      "Set workspace=true to scan all open files across running servers for errors. This is useful for project-wide error scouting.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Workspace mode: scan all open files across all running servers
      if (params.workspace) {
        const manager = getManager();
        if (!manager) {
          return toolError("LSP manager not initialized. Start a session first.");
        }

        try {
          const allDiags = manager.getAllDiagnostics();
          if (allDiags.size === 0) {
            return {
              content: [{ type: "text", text: "No diagnostics available. No files have been opened yet or no servers are running." }],
              details: { workspace: true, fileCount: 0, total: 0, errorCount: 0, warningCount: 0, infoCount: 0 },
            };
          }

          let totalErrors = 0;
          let totalWarnings = 0;
          let totalInfo = 0;
          let totalDiags = 0;
          const fileSections: string[] = [];

          for (const [uri, diagnostics] of allDiags) {
            if (diagnostics.length === 0) continue;

            const filePath = uri.startsWith("file://") ? uriToFilePath(uri) : uri;
            let errorCount = 0;
            let warningCount = 0;
            let infoCount = 0;
            for (const d of diagnostics) {
              if (d.severity === 1) errorCount++;
              else if (d.severity === 2) warningCount++;
              else if (d.severity === 3 || d.severity === 4) infoCount++;
            }

            totalErrors += errorCount;
            totalWarnings += warningCount;
            totalInfo += infoCount;
            totalDiags += diagnostics.length;

            const lines = diagnostics.map((d) => {
              const startLine = d.range.start.line + 1;
              const startCol = d.range.start.character + 1;
              const severity = SEVERITY_NAMES[d.severity ?? 0] ?? "?";
              const source = d.source ? `[${d.source}] ` : "";
              const code = d.code !== undefined ? ` (${d.code})` : "";
              return `  ${severity}: ${startLine}:${startCol}: ${source}${d.message}${code}`;
            });

            fileSections.push(
              `${filePath} (${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info):\n` +
              lines.join("\n"),
            );
          }

          const summary = `Workspace diagnostics:\n` +
            `${allDiags.size} file(s), ${totalErrors} error(s), ${totalWarnings} warning(s), ${totalInfo} info message(s)\n\n` +
            (fileSections.length > 0 ? fileSections.join("\n\n") : "No issues found.");

          return {
            content: [{ type: "text", text: summary }],
            details: { workspace: true, fileCount: allDiags.size, total: totalDiags, errorCount: totalErrors, warningCount: totalWarnings, infoCount: totalInfo },
          };
        } catch (err) {
          return toolError(sanitizeError(err, "Failed to get workspace diagnostics"));
        }
      }

      // File mode: check a specific file
      if (!params.file) {
        return toolError("No file or workspace mode specified. Provide a file path or set workspace=true.");
      }

      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { filePath, config, manager } = preamble.ok;

      try {
        const diagnostics = await manager.getDiagnostics(filePath, params.refresh ?? false);
        let errorCount = 0;
        let warningCount = 0;
        let infoCount = 0;
        for (const d of diagnostics) {
          if (d.severity === 1) errorCount++;
          else if (d.severity === 2) warningCount++;
          else if (d.severity === 3 || d.severity === 4) infoCount++;
        }

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
        return toolError(sanitizeError(err, "Failed to get diagnostics"), { file: params.file });
      }
    },
  });
}
