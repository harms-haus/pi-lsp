/**
 * find_type_definition tool: Find where the type of a symbol is defined
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { registerLocationTool } from "./location-tool-factory.js";

export function registerFindTypeDefinitionTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  registerLocationTool(pi, getManager, getCwd, {
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
    resultLabel: "Type definition found",
    resultKey: "locations",
    locationSuffix: true,
    method: (client, uri, line, col) => client.findTypeDefinition(uri, line, col),
  });
}
