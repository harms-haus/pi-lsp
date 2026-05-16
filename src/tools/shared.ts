/**
 * Shared utilities for LSP tool handlers
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Location } from "vscode-languageserver-types";
import type { LspManager } from "../lsp-manager.js";
import type { LspClient } from "../lsp-client-methods.js";
import type { LspServerConfig } from "../types.js";
import {
  LANGUAGE_SERVERS,
  languageFromPath,
  isServerInstalled,
} from "../language-config.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum number of symbol results to display */
export const MAX_SYMBOL_RESULTS = 50;

/** Diagnostic severity names indexed by LSP DiagnosticSeverity enum */
export const SEVERITY_NAMES = ["?", "Error", "Warning", "Info", "Hint"] as const;

/** Symbol kind names indexed by LSP SymbolKind enum */
export const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
  15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
  20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};

/** Reverse lookup: kind name (lowercase) → SymbolKind number */
const SYMBOL_KIND_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(SYMBOL_KIND_NAMES).map(([num, name]) => [name.toLowerCase(), Number(num)])
);

/** Parse a kind name or number string into a SymbolKind number, or undefined */
export function parseSymbolKind(kind: string): number | undefined {
  // Try as number first
  const num = Number(kind);
  if (!Number.isNaN(num) && SYMBOL_KIND_NAMES[num]) return num;
  // Try as name (case-insensitive)
  return SYMBOL_KIND_BY_NAME[kind.toLowerCase()];
}

// ── UI Interface (for typing the `ui` parameter) ──────────────────────────

interface ToolUI {
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level: "info" | "warning" | "error" | "success"): void;
}

// ── Path Helpers ───────────────────────────────────────────────────────────

/** Resolve a file path relative to cwd, with workspace boundary validation */
export function resolveFile(file: string, cwd: string): string {
  const resolved = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  // Normalize to prevent path traversal
  const normalized = path.normalize(resolved);
  // Validate the resolved path is within the workspace
  try {
    const realCwd = fs.realpathSync(cwd);
    // For paths that don't exist yet, use normalized path; for existing paths, use realpath
    let realPath: string;
    try {
      realPath = fs.realpathSync(normalized);
    } catch {
      // File doesn't exist — resolve the parent directory instead
      const parent = path.dirname(normalized);
      try {
        const realParent = fs.realpathSync(parent);
        realPath = path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(`Path traversal: "${file}" resolves outside the workspace.`);
      }
    }
    if (!realPath.startsWith(realCwd + path.sep) && realPath !== realCwd) {
      throw new Error(`Path traversal: "${file}" resolves outside the workspace.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Path traversal:")) throw err;
    // If realpath fails (cwd doesn't exist), just use normalized path
  }
  return normalized;
}

/** Convert a file:// URI to a local file path */
export function uriToFilePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

/** Convert a local file path to a file:// URI */
export function filePathToUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

// ── Server Install ─────────────────────────────────────────────────────────

/** Ensure an LSP server is installed, prompting the user if needed */
export async function ensureServerInstalled(
  language: string,
  ui: ToolUI,
): Promise<boolean> {
  const config = LANGUAGE_SERVERS.find((c) => c.language === language);
  if (!config) return false;

  const installed = await isServerInstalled(config);
  if (installed) return true;

  const ok = await ui.confirm(
    `Install LSP server: ${language}`,
    `The ${language} language server is not installed.\n\nInstall command: ${config.installCommand}\n\nWould you like to install it now?`,
  );
  if (!ok) return false;

  ui.notify(`Installing ${language} LSP server...`, "info");

  const { execFile } = await import("node:child_process");
  const installParts = config.installCommand.split(/\s+/);
  const installCmd = installParts[0];
  const installArgs = installParts.slice(1);
  const result = await new Promise<{ success: boolean; output: string }>((resolve) => {
    execFile(installCmd, installArgs, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = stdout + stderr;
      resolve({ success: !error, output });
    });
  });

  if (!result.success) {
    ui.notify(`Failed to install ${language} LSP server. Check the install command: ${config.installCommand}`, "error");
    return false;
  }

  ui.notify(`${language} LSP server installed successfully.`, "success");

  // Verify installation
  const verified = await isServerInstalled(config);
  if (!verified) {
    ui.notify(`Installation verification failed for ${language}. You may need to restart pi.`, "warning");
    return false;
  }

  return true;
}

// ── Tool Preamble (shared across 5 tools) ─────────────────────────────────

/** Result of the common tool preamble */
export interface PreambleResult {
  filePath: string;
  config: LspServerConfig;
  client: LspClient;
  uri: string;
  manager: LspManager;
}

/**
 * Execute the shared preamble that all file-based LSP tools need:
 * 1. Resolve file path
 * 2. Detect language
 * 3. Ensure server is installed
 * 4. Get or start LSP client
 * 5. Ensure file is open in the server
 * 6. Convert to URI
 *
 * Returns the preamble result or an error response object.
 */
export async function executePreamble(
  file: string,
  cwd: string,
  getManager: () => LspManager | null,
  ui: ToolUI,
): Promise<{ ok: PreambleResult } | { error: { content: { type: string; text: string }[]; details: Record<string, unknown>; isError: boolean } }> {
  const manager = getManager();
  if (!manager) {
    return {
      error: {
        content: [{ type: "text", text: "LSP manager not initialized. Start a session first." }],
        details: {},
        isError: true,
      },
    };
  }

  const filePath = resolveFile(file, cwd);
  const config = languageFromPath(filePath);

  if (!config) {
    return {
      error: {
        content: [{ type: "text", text: `No LSP server configured for "${file}".\n\nSupported languages: ${LANGUAGE_SERVERS.map((c) => c.language).join(", ")}` }],
        details: { file },
        isError: true,
      },
    };
  }

  const installed = await isServerInstalled(config);
  if (!installed) {
    const available = await ensureServerInstalled(config.language, ui);
    if (!available) {
      return {
        error: {
          content: [{ type: "text", text: `LSP server for ${config.language} is not installed.\n\nInstall: ${config.installCommand}` }],
          details: { file },
          isError: true,
        },
      };
    }
  }

  const client = await manager.getClientForConfig(config);
  if (!client) {
    return {
      error: {
        content: [{ type: "text", text: `Failed to start LSP server for ${config.language}.` }],
        details: { file },
        isError: true,
      },
    };
  }

  const uri = filePathToUri(filePath);
  await manager.ensureFileOpen(client, config, filePath);

  return { ok: { filePath, config, client, uri, manager } };
}

// ── Error Response Builder ─────────────────────────────────────────────────

/** Build a standard error tool result */
export function toolError(message: string, details: Record<string, unknown> = {}): {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    details,
    isError: true,
  };
}

// ── Error Sanitization ─────────────────────────────────────────────────────

/** Sanitize an error for safe display in tool results (avoids leaking internal paths/details) */
export function sanitizeError(err: unknown, context: string): string {
  const message = err instanceof Error ? err.message : String(err);
  // Strip common internal path patterns
  const sanitized = message
    .replace(/\/home\/[^/\s]+/g, "~")
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/\/root\//g, "/")
    .replace(/C:\\\\Users\\[^\\]+/g, "~");
  return `${context}: ${sanitized}`;
}

// ── Diagnostics Helpers ───────────────────────────────────────────────────

/** Count diagnostics by severity */
export function countSeverities(diagnostics: { severity?: number }[]): {
  errors: number;
  warnings: number;
  info: number;
} {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const d of diagnostics) {
    if (d.severity === 1) errors++;
    else if (d.severity === 2) warnings++;
    else if (d.severity === 3 || d.severity === 4) info++;
  }
  return { errors, warnings, info };
}

/** Format a single diagnostic as `severity: line:col: [source] message (code)` */
export function formatDiagnosticLine(d: {
  range: { start: { line: number; character: number } };
  severity?: number;
  source?: string;
  message: string;
  code?: string | number | { value: string | number };
}): string {
  const startLine = d.range.start.line + 1;
  const startCol = d.range.start.character + 1;
  const severity = SEVERITY_NAMES[d.severity ?? 0] ?? "?";
  const source = d.source ? `[${d.source}] ` : "";
  const codeVal =
    d.code !== undefined
      ? typeof d.code === "object"
        ? ` (${(d.code as { value: string | number }).value})`
        : ` (${d.code})`
      : "";
  return `  ${severity}: ${startLine}:${startCol}: ${source}${d.message}${codeVal}`;
}

// ── Workspace Boundary Check ───────────────────────────────────────────────

/** Check whether a file path is within the given workspace root */
export function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  const normalizedFile = path.normalize(filePath);
  const normalizedRoot = path.normalize(workspaceRoot);
  try {
    const realRoot = fs.realpathSync(workspaceRoot);
    let realFile: string;
    try {
      realFile = fs.realpathSync(normalizedFile);
    } catch {
      // File doesn't exist — resolve the parent directory instead
      const parent = path.dirname(normalizedFile);
      try {
        const realParent = fs.realpathSync(parent);
        realFile = path.join(realParent, path.basename(normalizedFile));
      } catch {
        return false;
      }
    }
    return realFile.startsWith(realRoot + path.sep) || realFile === realRoot;
  } catch {
    return normalizedFile.startsWith(normalizedRoot + path.sep);
  }
}

// ── Location Helpers ───────────────────────────────────────────────────────

/** Normalize LSP Location result (single, array, or null) into a flat array */
export function flattenLocations(result: Location | Location[] | null): Location[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "uri" in result) return [result];
  return [];
}

/** Format locations as `filepath:line:col` lines */
export function formatLocations(locations: Location[]): string {
  return locations.length > 0
    ? locations.map((l) => `  ${uriToFilePath(l.uri)}:${l.range.start.line + 1}:${l.range.start.character + 1}`).join("\n")
    : "(none)";
}

// ── Text/Diff Utilities ────────────────────────────────────────────────────

/** Apply LSP TextEdits to source text, returning the modified text */
export function applyEdits(text: string, edits: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });

  const lines = text.split("\n");
  for (const edit of sorted) {
    const { start, end } = edit.range;
    const prefix = (lines[start.line] || "").slice(0, start.character);
    const suffix = (lines[end.line] || "").slice(end.character);
    const newContent = prefix + edit.newText + suffix;
    const newLinesArr = newContent.split("\n");

    const newArr = [
      ...(start.line > 0 ? lines.slice(0, start.line) : []),
      ...newLinesArr,
      ...(end.line + 1 < lines.length ? lines.slice(end.line + 1) : []),
    ];

    lines.length = 0;
    lines.push(...newArr);
  }

  return lines.join("\n");
}

/** Build a unified diff string from original and modified text */
export function buildDiff(filePath: string, original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const hunkLines: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  let hasChanges = false;

  const maxLines = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLines; i++) {
    const orig = i < origLines.length ? origLines[i] : undefined;
    const mod = i < modLines.length ? modLines[i] : undefined;

    if (orig === mod) {
      if (hasChanges) {
        hunkLines.push(` ${orig ?? ""}`);
        oldLine++;
        newLine++;
      } else {
        oldLine++;
        newLine++;
      }
    } else {
      if (!hasChanges) {
        hunkLines.push(`@@ -${oldLine},${Math.max(origLines.length - oldLine + 1, 1)} +${newLine},${Math.max(modLines.length - newLine + 1, 1)} @@`);
      }
      hasChanges = true;
      if (orig !== undefined) {
        hunkLines.push(`-${orig}`);
        oldLine++;
      }
      if (mod !== undefined) {
        hunkLines.push(`+${mod}`);
        newLine++;
      }
    }
  }

  if (hunkLines.length === 0) {
    hunkLines.push(`@@ -0,0 +0,0 @@\n (no changes)`);
  }

  return `--- a/${filePath}\n+++ b/${filePath}\n${hunkLines.join("\n")}`;
}
