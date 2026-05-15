/**
 * find_document_symbols tool: Get an outline of all symbols in a file
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { executePreamble, toolError, SYMBOL_KIND_NAMES } from "./shared.js";
import type { DocumentSymbol, SymbolInformation } from "vscode-languageserver-types";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file to outline" }),
});

interface FlatSymbol {
  name: string;
  kind: string;
  line: number;
}

function formatDocumentSymbols(symbols: DocumentSymbol[], indent: string, flat: FlatSymbol[]): string {
  const lines: string[] = [];
  for (const sym of symbols) {
    const kindName = SYMBOL_KIND_NAMES[sym.kind] || `Kind(${sym.kind})`;
    const line = sym.range.start.line + 1;
    flat.push({ name: sym.name, kind: kindName, line });
    lines.push(`${indent}${kindName} ${sym.name} (line ${line})`);
    if (sym.children && sym.children.length > 0) {
      lines.push(formatDocumentSymbols(sym.children, indent + "  ", flat));
    }
  }
  return lines.join("\n");
}

function formatSymbolInformationList(symbols: SymbolInformation[], flat: FlatSymbol[]): string {
  const lines: string[] = [];
  for (const sym of symbols) {
    const kindName = SYMBOL_KIND_NAMES[sym.kind] || `Kind(${sym.kind})`;
    const line = sym.location.range.start.line + 1;
    flat.push({ name: sym.name, kind: kindName, line });
    lines.push(`  ${kindName} ${sym.name} (line ${line})`);
  }
  return lines.join("\n");
}

export function registerFindDocumentSymbolsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "find_document_symbols",
    label: "Find Document Symbols",
    description:
      "Get an outline of all symbols (classes, functions, variables, etc.) in a file. Useful for understanding file structure without reading the entire file.",
    promptSnippet: "Get a file outline showing all symbols (classes, methods, functions)",
    promptGuidelines: [
      "Use find_document_symbols to get a structured outline of a file before diving in.",
      "Returns symbol names, kinds (class/function/variable), and line numbers.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const result = await client.documentSymbol(uri);

        if (!result || result.length === 0) {
          return {
            content: [{ type: "text", text: `No symbols found in ${params.file}.` }],
            details: { file: params.file, count: 0, symbols: [] },
          };
        }

        const flat: FlatSymbol[] = [];
        let formatted: string;

        // DocumentSymbol has a `children` property; SymbolInformation has a `location` property
        if ("children" in result[0]) {
          formatted = formatDocumentSymbols(result as DocumentSymbol[], "", flat);
        } else {
          formatted = formatSymbolInformationList(result as SymbolInformation[], flat);
        }

        const text = `Document symbols for ${params.file}:\n${flat.length} symbols found\n\n${formatted}`;

        return {
          content: [{ type: "text", text }],
          details: { file: params.file, count: flat.length, symbols: flat },
        };
      } catch (err) {
        return toolError(`Failed to get document symbols: ${(err as Error).message}`, { file: params.file });
      }
    },
  });
}
