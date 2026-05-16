/**
 * find_definition tool: Find symbol definition
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { registerLocationTool } from "./location-tool-factory.js";

export function registerFindDefinitionTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  registerLocationTool(pi, getManager, getCwd, {
    name: "find_definition",
    label: "Find Definition",
    description: "Find where the symbol at the given position is defined. Returns the definition location(s).",
    promptSnippet: "Find where a symbol is defined",
    promptGuidelines: [
      "Use find_definition with file path, line, and column to jump to a symbol's definition.",
      "Line and column are 1-indexed.",
    ],
    resultLabel: "Definition found",
    resultKey: "definitions",
    locationSuffix: true,
    method: (client, uri, line, col) => client.gotoDefinition(uri, line, col),
  });
}
