/**
 * find_implementations tool: Find all implementations of an interface, abstract class, or type
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "../lsp-manager.js";
import { registerLocationTool } from "./location-tool-factory.js";

export function registerFindImplementationsTool(
  pi: ExtensionAPI,
  getManager: () => LspManager | null,
  getCwd: () => string,
): void {
  registerLocationTool(pi, getManager, getCwd, {
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
    resultLabel: "Implementations found",
    resultKey: "implementations",
    locationSuffix: false,
    method: (client, uri, line, col) => client.findImplementations(uri, line, col),
  });
}
