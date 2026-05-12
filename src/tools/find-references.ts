/**
 * lsp-find-references tool: Find all references to a symbol
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { executePreamble, toolError, uriToFilePath } from "./shared.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

export function registerFindReferencesTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "lsp-find-references",
    label: "LSP Find References",
    description: "Find all references to the symbol at the given position in a file. Returns a list of locations where the symbol is used.",
    promptSnippet: "Find all references to a symbol in the codebase",
    promptGuidelines: [
      "Use lsp-find-references with file path, line, and column to find all references to a symbol.",
      "Line and column are 1-indexed.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const result = await client.findReferences(uri, params.line - 1, params.column - 1);
        const locations: { uri: string; line: number; col: number }[] = Array.isArray(result)
          ? result.map((loc) => ({
              uri: loc.uri,
              line: loc.range.start.line + 1,
              col: loc.range.start.character + 1,
            }))
          : [];

        const formatted = locations.length > 0
          ? locations.map((l) => `  ${uriToFilePath(l.uri)}:${l.line}:${l.col}`).join("\n")
          : "(none)";

        return {
          content: [{ type: "text", text: `References found: ${locations.length}\n\n${formatted}` }],
          details: { file: params.file, line: params.line, column: params.column, references: locations, count: locations.length },
        };
      } catch (err) {
        return toolError(`Failed to find references: ${(err as Error).message}`, { file: params.file, line: params.line, column: params.column });
      }
    },
  });
}
