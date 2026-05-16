/**
 * Formatting utilities for LSP tool handlers
 *
 * Diagnostic formatting, symbol kind mappings, error sanitization,
 * and standard error response builders.
 */

// ── Constants ──────────────────────────────────────────────────────────────

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
