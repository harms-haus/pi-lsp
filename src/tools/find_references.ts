/**
 * find_references tool: Find all references to a symbol
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { registerLocationTool } from "./location-tool-factory.js";

export function registerFindReferencesTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  registerLocationTool(pi, getManager, getCwd, {
    name: "find_references",
    label: "Find References",
    description: "Find all references to the symbol at the given position in a file. Returns a list of locations where the symbol is used.",
    promptSnippet: "Find all references to a symbol in the codebase",
    promptGuidelines: [
      "Use find_references with file path, line, and column to find all references to a symbol.",
      "Line and column are 1-indexed.",
    ],
    resultLabel: "References found",
    resultKey: "references",
    locationSuffix: false,
    method: (client, uri, line, col) => client.findReferences(uri, line, col),
  });
}
