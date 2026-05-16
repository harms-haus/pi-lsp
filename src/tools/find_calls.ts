/**
 * find_calls tool: Show incoming/outgoing calls for a function
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import type { CallHierarchyIncomingCall, CallHierarchyOutgoingCall } from "vscode-languageserver-types";
import { executePreamble } from "./preamble.js";
import { toolError, sanitizeError } from "./formatting.js";
import { uriToFilePath } from "./paths.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

export function registerFindCallsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "find_calls",
    label: "Find Calls",
    description: "List callers and callees for a function at the given position. Shows incoming calls (who calls this) and outgoing calls (what this calls).",
    promptSnippet: "Show what calls a function and what it calls",
    promptGuidelines: [
      "Use find_calls with file path, line, and column on a function/method to see its callers and callees.",
      "Line and column are 1-indexed.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const prepareResult = await client.prepareCallHierarchy(uri, params.line - 1, params.column - 1);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP prepareCallHierarchy can return null/undefined
        const items = Array.isArray(prepareResult) ? prepareResult : (prepareResult ? [prepareResult] : []);

        if (items.length === 0) {
          return { content: [{ type: "text", text: "No call hierarchy available at this position. Place cursor on a function/method name." }], details: { file: params.file } };
        }

        const item = items[0];
        let incomingCalls: CallHierarchyIncomingCall[] = [];
        let outgoingCalls: CallHierarchyOutgoingCall[] = [];

        try {
          const incoming = await client.incomingCalls(item);
          incomingCalls = Array.isArray(incoming) ? incoming : [];
        } catch { /* not supported */ }

        try {
          const outgoing = await client.outgoingCalls(item);
          outgoingCalls = Array.isArray(outgoing) ? outgoing : [];
        } catch { /* not supported */ }

        const formatCall = (
          call: CallHierarchyIncomingCall | CallHierarchyOutgoingCall,
        ) => {
          const node = "from" in call ? call.from : call.to;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP call hierarchy item is loosely typed, need runtime checks
          const name = node.name ?? "(unknown)";
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP call hierarchy item is loosely typed, need runtime checks
          const uri = node.uri ?? "";
          const fp = uriToFilePath(uri);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP call hierarchy item is loosely typed, need runtime checks
          const line = node.range?.start?.line ? node.range.start.line + 1 : "?";
          const ranges = ((call.fromRanges as (typeof call.fromRanges) | undefined) ?? []).map((r) => `    at line ${r.start.line + 1}`).join("\n");
          return `  ${name} — ${fp}:${line}\n${ranges}`;
        };

        let output = `Call hierarchy for "${item.name}" in ${params.file}:${params.line}:${params.column}\n`;

        if (incomingCalls.length > 0) {
          output += `\n─── Incoming Calls (${incomingCalls.length}) ───\n`;
          output += incomingCalls.map((c) => formatCall(c)).join("\n\n");
        }

        if (outgoingCalls.length > 0) {
          output += `\n─── Outgoing Calls (${outgoingCalls.length}) ───\n`;
          output += outgoingCalls.map((c) => formatCall(c)).join("\n\n");
        }

        if (incomingCalls.length === 0 && outgoingCalls.length === 0) {
          output += "\nNo incoming or outgoing calls found.";
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            file: params.file,
            line: params.line,
            column: params.column,
            functionName: item.name,
            incomingCount: incomingCalls.length,
            outgoingCount: outgoingCalls.length,
          },
        };
      } catch (err) {
        return toolError(sanitizeError(err, "Failed to get call hierarchy"), { file: params.file });
      }
    },
  });
}
