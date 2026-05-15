/**
 * find_type_definition tool: Find where the type of a symbol is defined
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { executePreamble, toolError, uriToFilePath, sanitizeError } from "./shared.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

export function registerFindTypeDefinitionTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "find_type_definition",
    label: "Find Type Definition",
    description:
      "Find where the TYPE of the symbol at the given position is defined. Unlike find_definition which goes to where the symbol itself is defined, this goes to where its type is defined. For example, on `const user: User`, find_definition goes to the assignment, find_type_definition goes to the User class.",
    promptSnippet: "Jump to the type definition of a symbol",
    promptGuidelines: [
      "Use find_type_definition with file path, line, and column to jump to where the type of a variable or expression is defined.",
      "Different from find_definition: find_type_definition goes to the TYPE, not the variable declaration.",
      "Line and column are 1-indexed.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const result = await client.findTypeDefinition(uri, params.line - 1, params.column - 1);
        let locations: { uri: string; line: number; col: number }[] = [];

        if (Array.isArray(result)) {
          locations = result.map((loc) => ({
            uri: loc.uri,
            line: loc.range.start.line + 1,
            col: loc.range.start.character + 1,
          }));
        } else if (result && typeof result === "object" && "uri" in result) {
          locations = [{
            uri: result.uri,
            line: result.range.start.line + 1,
            col: result.range.start.character + 1,
          }];
        }

        const formatted = locations.length > 0
          ? locations.map((l) => `  ${uriToFilePath(l.uri)}:${l.line}:${l.col}`).join("\n")
          : "(none)";

        return {
          content: [{ type: "text", text: `Type definition found: ${locations.length} location(s)\n\n${formatted}` }],
          details: { file: params.file, line: params.line, column: params.column, locations, count: locations.length },
        };
      } catch (err) {
        return toolError(sanitizeError(err, "Failed to find type definition"), { file: params.file, line: params.line, column: params.column });
      }
    },
  });
}
