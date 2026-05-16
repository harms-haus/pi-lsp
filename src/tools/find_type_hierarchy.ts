/**
 * find_type_hierarchy tool: Show the inheritance chain for a type
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { executePreamble, uriToFilePath, SYMBOL_KIND_NAMES } from "./shared.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
  direction: Type.Optional(Type.String({ description: 'Direction: "supertypes" (parents/ancestors) or "subtypes" (children/descendants). Default: both' })),
  depth: Type.Optional(Type.Number({ description: "Maximum depth to traverse. Default: 2" })),
});

export function registerFindTypeHierarchyTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "find_type_hierarchy",
    label: "Find Type Hierarchy",
    description: "Show the inheritance chain for a class or type. Returns parent types (supertypes) and/or child types (subtypes). Not all language servers support this — returns a clear message if unsupported.",
    promptSnippet: "Show inheritance chain for a class or type",
    promptGuidelines: [
      'Use find_type_hierarchy with file path, line, and column on a class/type to see its inheritance chain.',
      'Set direction to "supertypes" to see parent chain, "subtypes" to see descendants.',
      "If the language server does not support type hierarchy, the tool will return a clear message.",
      "Line and column are 1-indexed.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      // Validate direction parameter
      if (params.direction && params.direction !== "supertypes" && params.direction !== "subtypes" && params.direction !== "both") {
        params.direction = "both";
      }

      let prepareResult: Awaited<ReturnType<typeof client.prepareTypeHierarchy>>;
      try {
        prepareResult = await client.prepareTypeHierarchy(uri, params.line - 1, params.column - 1);
      } catch {
        return {
          content: [{ type: "text", text: "Type hierarchy is not supported by this language server, or no type at this position." }],
          details: { file: params.file, supported: false },
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP prepareTypeHierarchy can return null/undefined
      const items = Array.isArray(prepareResult) ? prepareResult : (prepareResult ? [prepareResult] : []);

      if (items.length === 0) {
        return {
          content: [{ type: "text", text: "Type hierarchy is not supported by this language server, or no type at this position." }],
          details: { file: params.file, supported: false },
        };
      }

      const item = items[0];
      const typeName = item.name;
      const direction: string = (params.direction as string) || "both";

      let supertypes: typeof items = [];
      let subtypes: typeof items = [];

      if (direction === "supertypes" || direction === "both") {
        try {
          const result = await client.typeHierarchySupertypes(item, (params.depth as number) || 2);
          supertypes = Array.isArray(result) ? result : [];
        } catch { /* not supported */ }
      }

      if (direction === "subtypes" || direction === "both") {
        try {
          const result = await client.typeHierarchySubtypes(item, (params.depth as number) || 2);
          subtypes = Array.isArray(result) ? result : [];
        } catch { /* not supported */ }
      }

      const formatItem = (hi: { name: string; kind: number; uri: string; range: { start: { line: number } } }) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP type hierarchy item is loosely typed, need runtime checks
        const name = hi.name ?? "(unknown)";
        const kind = SYMBOL_KIND_NAMES[hi.kind] ?? "Unknown";
        const fp = uriToFilePath(hi.uri);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP type hierarchy item is loosely typed, need runtime checks
        const line = hi.range?.start?.line != null ? hi.range.start.line + 1 : "?";
        return `  ${name} (${kind}) — ${fp}:${line}`;
      };

      let output = `Type hierarchy for "${typeName}" in ${params.file}:${params.line}:${params.column}\n`;

      if (direction === "supertypes" || direction === "both") {
        output += `\n─── Supertypes (${supertypes.length}) ───\n`;
        if (supertypes.length > 0) {
          output += supertypes.map((s) => formatItem(s)).join("\n");
        } else {
          output += "  (none found)";
        }
      }

      if (direction === "subtypes" || direction === "both") {
        output += `\n─── Subtypes (${subtypes.length}) ───\n`;
        if (subtypes.length > 0) {
          output += subtypes.map((s) => formatItem(s)).join("\n");
        } else {
          output += "  (none found)";
        }
      }

      return {
        content: [{ type: "text", text: output }],
        details: {
          file: params.file,
          line: params.line,
          column: params.column,
          typeName,
          supertypes: supertypes.map((s) => ({ name: s.name, kind: s.kind, uri: uriToFilePath(s.uri), line: s.range.start.line + 1 })),
          subtypes: subtypes.map((s) => ({ name: s.name, kind: s.kind, uri: uriToFilePath(s.uri), line: s.range.start.line + 1 })),
          supported: true,
        },
      };
    },
  });
}
