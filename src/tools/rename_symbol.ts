/**
 * rename_symbol tool: Rename a symbol across the codebase
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import type { TextDocumentEdit, TextEdit, Range } from "vscode-languageserver-types";
import * as fs from "node:fs";
import {
  applyEdits,
  buildDiff,
} from "./shared.js";
import { executePreamble } from "./preamble.js";
import { toolError, sanitizeError } from "./formatting.js";
import { uriToFilePath, isWithinWorkspace } from "./paths.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
  newName: Type.String({ description: "New name for the symbol" }),
});

export function registerRenameSymbolTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  pi.registerTool({
    name: "rename_symbol",
    label: "Rename Symbol",
    description: "Rename a symbol at the given position. Returns a unified diff patch that can be applied with the edit tool. Does NOT automatically apply changes.",
    promptSnippet: "Rename a symbol across the codebase (returns a patch to apply)",
    promptGuidelines: [
      "Use rename_symbol to rename a symbol. It returns a patch — use the edit tool to apply it.",
      "Do not apply the patch automatically; show it to the user first.",
    ],
    parameters: Schema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri, filePath } = preamble.ok;
      const cwd = getCwd();

      try {
        // Try to get the current symbol name
        let oldName = "(unknown)";
        let renameRange: Range | null = null;
        try {
          const prepareResult = await client.prepareRename(uri, params.line - 1, params.column - 1);
          if (prepareResult && typeof prepareResult === "object") {
            if ("placeholder" in prepareResult) {
              oldName = prepareResult.placeholder;
              renameRange = (prepareResult as { range: Range; placeholder: string }).range;
            } else if ("start" in prepareResult && "end" in prepareResult) {
              renameRange = prepareResult as Range;
            }
          }
        } catch {
          // prepareRename not supported
        }

        // If we got a range but no placeholder, extract the text from the file
        if (oldName === "(unknown)" && renameRange) {
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const startLine = lines[renameRange.start.line] || "";
            const endLine = lines[renameRange.end.line] || "";
            if (renameRange.start.line === renameRange.end.line) {
              oldName = startLine.slice(renameRange.start.character, renameRange.end.character);
            } else {
              oldName = startLine.slice(renameRange.start.character) + "\n" + endLine.slice(0, renameRange.end.character);
            }
          } catch { /* ignore */ }
        }

        // Final fallback: extract word at cursor position
        if (oldName === "(unknown)") {
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const lineContent = lines[params.line - 1] ?? "";
            const col = params.column - 1;
            const before = lineContent.slice(0, col).match(/[\w$]+$/)?.[0] ?? "";
            const after = lineContent.slice(col).match(/^[\w$]+/)?.[0] ?? "";
            oldName = before + after || "(unknown)";
          } catch { /* ignore */ }
        }

        const workspaceEdit = await client.rename(uri, params.line - 1, params.column - 1, params.newName);

        // Build patch — handle both `changes` and `documentChanges` formats
        const patchParts: string[] = [];
        let fileCount = 0;

        // Handle documentChanges format (LSP 3.17+)
        const docChanges = workspaceEdit?.documentChanges ?? [];
        for (const dc of docChanges) {
          // Only process TextDocumentEdit operations (they have textDocument and edits properties)
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP workspace edit is loosely typed, need runtime checks
          if (typeof dc === "object" && dc !== null && "textDocument" in dc && "edits" in dc) {
            const textEdit = dc as TextDocumentEdit;
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP workspace edit is loosely typed, need runtime checks
            if (textEdit.textDocument && textEdit.edits && Array.isArray(textEdit.edits)) {
              const changeUri = textEdit.textDocument.uri;
              const changePath = uriToFilePath(changeUri);
              if (!isWithinWorkspace(changePath, cwd)) {
                patchParts.push(`--- skipped: ${changePath} (outside workspace)`);
                continue;
              }
              const sorted = [...textEdit.edits].sort((a: TextEdit, b: TextEdit) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
              fileCount++;
              try {
                const original = fs.readFileSync(changePath, "utf-8");
                const modified = applyEdits(original, sorted);
                patchParts.push(buildDiff(changePath, original, modified));
              } catch {
                const newText = sorted.map((e: TextEdit) => e.newText).join("");
                const lineCount = newText ? newText.split("\n").length : 0;
                patchParts.push(`--- /dev/null\n+++ ${changePath}\n@@ -0,0 +1,${lineCount} @@\n${newText.split("\n").map((l: string) => "+" + l).join("\n")}`);
              }
            }
          }
        }

        // Handle legacy changes format
        const changes = workspaceEdit?.changes ?? {};
        for (const [changeUri, edits] of Object.entries(changes) as [string, TextEdit[]][]) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- LSP workspace edit is loosely typed, need runtime checks
          if (fileCount > 0 && docChanges.some((dc) => typeof dc === "object" && dc !== null && "textDocument" in dc && dc.textDocument?.uri === changeUri)) continue;
          const changePath = uriToFilePath(changeUri);
          if (!isWithinWorkspace(changePath, cwd)) {
            patchParts.push(`--- skipped: ${changePath} (outside workspace)`);
            continue;
          }
          const sorted = [...edits].sort((a: TextEdit, b: TextEdit) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
          fileCount++;
          try {
            const original = fs.readFileSync(changePath, "utf-8");
            const modified = applyEdits(original, sorted);
            patchParts.push(buildDiff(changePath, original, modified));
          } catch {
            const newText = sorted.map((e: TextEdit) => e.newText).join("");
            const lineCount = newText ? newText.split("\n").length : 0;
            patchParts.push(`--- /dev/null\n+++ ${changePath}\n@@ -0,0 +1,${lineCount} @@\n${newText.split("\n").map((l: string) => "+" + l).join("\n")}`);
          }
        }

        const patch = patchParts.join("\n\n") || "No changes generated.";

        return {
          content: [{
            type: "text",
            text: `Rename "${oldName}" → "${params.newName}"\nFile: ${params.file}\nFiles affected: ${fileCount}\n\nPatch:\n\`\`\`diff\n${patch}\n\`\`\`\n\nUse the edit tool to apply these changes.`,
          }],
          details: { file: params.file, oldName, newName: params.newName, patch, fileCount },
        };
      } catch (err) {
        return toolError(sanitizeError(err, "Failed to rename symbol"), { file: params.file });
      }
    },
  });
}
