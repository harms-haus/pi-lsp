/**
 * hover tool: Get type information, signature, and documentation at a position
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Hover } from "vscode-languageserver-types";
import type { LspManager } from "../lsp-manager.js";
import { executePreamble, toolError } from "./shared.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

function formatHoverContents(contents: Hover["contents"]): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(formatHoverContents).join("\n\n");
  if (typeof contents === "object") {
    if ("kind" in contents && "value" in contents) {
      // MarkupContent
      return contents.value;
    }
    if ("language" in contents && "value" in contents) {
      // MarkedString (code block)
      return "```" + contents.language + "\n" + contents.value + "\n```";
    }
  }
  return String(contents);
}

export function registerHoverTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "hover",
    label: "Hover",
    description:
      "Get type information, signature, and documentation for the symbol at a given position. Shows the inferred or declared type, function signatures, and doc comments.",
    promptSnippet: "Inspect a symbol's type, signature, or documentation",
    promptGuidelines: [
      "Use hover with file path, line, and column to quickly see the type of a variable or signature of a function.",
      "Hover returns type info, documentation, and signatures without needing to navigate to the definition.",
      "Line and column are 1-indexed.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const result = await client.hover(uri, params.line - 1, params.column - 1);

        if (!result) {
          return {
            content: [{ type: "text", text: "No hover information available at this position." }],
            details: { file: params.file, line: params.line, column: params.column, hoverContent: null, range: null },
          };
        }

        const hoverContent = formatHoverContents(result.contents);
        const range = result.range
          ? {
              startLine: result.range.start.line + 1,
              startCol: result.range.start.character + 1,
              endLine: result.range.end.line + 1,
              endCol: result.range.end.character + 1,
            }
          : null;

        let text = `Hover info at ${params.file}:${params.line}:${params.column}:\n\n${hoverContent}`;
        if (range) {
          text += `\n\nRange: line ${range.startLine}:${range.startCol} to line ${range.endLine}:${range.endCol}`;
        }

        return {
          content: [{ type: "text", text }],
          details: { file: params.file, line: params.line, column: params.column, hoverContent, range },
        };
      } catch (err) {
        return toolError(`Failed to get hover information: ${(err as Error).message}`, {
          file: params.file,
          line: params.line,
          column: params.column,
        });
      }
    },
  });
}
