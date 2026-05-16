/**
 * find_definition tool: Find symbol definition
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { executePreamble, toolError, flattenLocations, formatLocations, sanitizeError } from "./shared.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

export function registerFindDefinitionTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "find_definition",
    label: "Find Definition",
    description: "Find where the symbol at the given position is defined. Returns the definition location(s).",
    promptSnippet: "Find where a symbol is defined",
    promptGuidelines: [
      "Use find_definition with file path, line, and column to jump to a symbol's definition.",
      "Line and column are 1-indexed.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const result = await client.gotoDefinition(uri, params.line - 1, params.column - 1);
        const locations = flattenLocations(result);
        const formatted = formatLocations(locations);
        const mapped = locations.map((l) => ({ uri: l.uri, line: l.range.start.line + 1, col: l.range.start.character + 1 }));

        return {
          content: [{ type: "text", text: `Definition found: ${mapped.length} location(s)\n\n${formatted}` }],
          details: { file: params.file, line: params.line, column: params.column, definitions: mapped, count: mapped.length },
        };
      } catch (err) {
        return toolError(sanitizeError(err, "Failed to find definition"), { file: params.file });
      }
    },
  });
}
