/**
 * find_implementations tool: Find all implementations of an interface, abstract class, or type
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

export function registerFindImplementationsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "find_implementations",
    label: "Find Implementations",
    description:
      "Find all implementations of an interface, abstract class, or type at the given position. Returns locations of concrete implementations.",
    promptSnippet: "Find all implementations of an interface or abstract class",
    promptGuidelines: [
      "Use find_implementations with file path, line, and column on an interface, abstract class, or type to find its concrete implementations.",
      "Line and column are 1-indexed.",
      "Works best on interface/type definitions — place cursor on the type name itself.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const result = await client.findImplementations(uri, params.line - 1, params.column - 1);
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
          content: [{ type: "text", text: `Implementations found: ${locations.length}\n\n${formatted}` }],
          details: {
            file: params.file,
            line: params.line,
            column: params.column,
            implementations: locations,
            count: locations.length,
          },
        };
      } catch (err) {
        return toolError(`Failed to find implementations: ${(err as Error).message}`, {
          file: params.file,
          line: params.line,
          column: params.column,
        });
      }
    },
  });
}
