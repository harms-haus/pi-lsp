/**
 * Shared utilities for LSP tool handlers
 */

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum number of symbol results to display */
export const MAX_SYMBOL_RESULTS = 50;

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

// ── Re-exports from submodules for backward compatibility ──────────────────

export { resolveFile, uriToFilePath, filePathToUri, isWithinWorkspace, flattenLocations, formatLocations } from "./paths.js";
export { SEVERITY_NAMES, SYMBOL_KIND_NAMES, parseSymbolKind, countSeverities, formatDiagnosticLine, sanitizeError, toolError } from "./formatting.js";
export { executePreamble, ensureServerInstalled } from "./preamble.js";
export type { PreambleResult } from "./preamble.js";