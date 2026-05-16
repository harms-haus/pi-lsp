import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  applyEdits,
  buildDiff,
  resolveFile,
  uriToFilePath,
  filePathToUri,
  parseSymbolKind,
  sanitizeError,
  flattenLocations,
  formatLocations,
  countSeverities,
  formatDiagnosticLine,
  isWithinWorkspace,
  executePreamble,
  ensureServerInstalled,
  toolError,
} from "../../src/tools/shared.js";

describe("applyEdits", () => {
  it("should insert text at the start of a file", () => {
    const text = "line2\nline3";
    const edits = [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "line1\n",
    }];
    expect(applyEdits(text, edits)).toBe("line1\nline2\nline3");
  });

  it("should insert text in the middle of a line", () => {
    const text = "hello world";
    const edits = [{
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
      newText: "beautiful ",
    }];
    expect(applyEdits(text, edits)).toBe("hellobeautiful  world");
  });

  it("should replace text within a line", () => {
    const text = "hello world";
    const edits = [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      newText: "goodbye",
    }];
    expect(applyEdits(text, edits)).toBe("goodbye world");
  });

  it("should delete text (empty newText)", () => {
    const text = "hello world";
    const edits = [{
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
      newText: "",
    }];
    expect(applyEdits(text, edits)).toBe("hello ");
  });

  it("should handle multi-line replacement", () => {
    const text = "line1\nline2\nline3\nline4";
    const edits = [{
      range: { start: { line: 1, character: 0 }, end: { line: 2, character: 5 } },
      newText: "REPLACEMENT",
    }];
    expect(applyEdits(text, edits)).toBe("line1\nREPLACEMENT\nline4");
  });

  it("should handle multiple edits (applied in reverse order)", () => {
    const text = "aaaa\nbbbb\ncccc";
    const edits = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: "1111" },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: "2222" },
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } }, newText: "3333" },
    ];
    expect(applyEdits(text, edits)).toBe("1111\n2222\n3333");
  });

  it("should handle empty edits array", () => {
    expect(applyEdits("hello world", [])).toBe("hello world");
  });

  it("should handle edit at the end of file", () => {
    const text = "hello";
    const edits = [{
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
      newText: " world",
    }];
    expect(applyEdits(text, edits)).toBe("hello world");
  });
});

describe("buildDiff", () => {
  it("should show 'no changes' for identical files", () => {
    const original = "line1\nline2\nline3";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("(no changes)");
  });

  it("should show single line change with correct hunk header", () => {
    const original = "line1\nline2\nline3";
    const modified = "line1\nmodified\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("--- a/test.ts");
    expect(diff).toContain("+++ b/test.ts");
    expect(diff).toContain("-line2");
    expect(diff).toContain("+modified");
  });

  it("should show added lines with + prefix", () => {
    const original = "line1\nline3";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("+line2");
  });

  it("should show removed lines with - prefix", () => {
    const original = "line1\nline2\nline3";
    const modified = "line1\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("-line2");
  });

  it("should handle multiple changes", () => {
    const original = "line1\nline2\nline3\nline4";
    const modified = "line1\nmodified1\nline3\nmodified2";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("-line2");
    expect(diff).toContain("+modified1");
    expect(diff).toContain("-line4");
    expect(diff).toContain("+modified2");
  });

  it("should handle adding at the beginning", () => {
    const original = "line2\nline3";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("+line1");
  });

  it("should handle adding at the end", () => {
    const original = "line1\nline2";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("+line3");
  });
});

describe("resolveFile", () => {
  it("should return absolute paths unchanged", () => {
    expect(resolveFile("/home/user/file.ts", "/home/other"))
      .toBe("/home/user/file.ts");
  });

  it("should resolve relative paths against cwd", () => {
    expect(resolveFile("src/file.ts", "/home/user"))
      .toBe("/home/user/src/file.ts");
  });

  it("should handle paths with ..", () => {
    expect(resolveFile("../file.ts", "/home/user/project"))
      .toBe("/home/user/file.ts");
  });

  it("should handle paths with .", () => {
    expect(resolveFile("./file.ts", "/home/user"))
      .toBe("/home/user/file.ts");
  });

  it("should handle complex relative paths", () => {
    // path.resolve in Node.js doesn't normalize .. in the same way as bash
    // It keeps the path as-is and resolves against cwd
    const result = resolveFile("src/../other/file.ts", "/home/user/project");
    expect(result).toContain("other/file.ts");
  });
});

describe("uriToFilePath", () => {
  it("should convert file:// URI to local path", () => {
    expect(uriToFilePath("file:///home/user/file.ts"))
      .toBe("/home/user/file.ts");
  });

  it("should decode URI-encoded characters", () => {
    expect(uriToFilePath("file:///home/my%20docs/file.ts"))
      .toBe("/home/my docs/file.ts");
  });

  it("should handle encoded slash", () => {
    expect(uriToFilePath("file:///home/user/file%2Fname.ts"))
      .toBe("/home/user/file/name.ts");
  });

  it("should handle empty URI", () => {
    expect(uriToFilePath("file://")).toBe("");
  });

  it("should handle URI with query string (not typical for files)", () => {
    expect(uriToFilePath("file:///home/user/file.ts?query=1"))
      .toBe("/home/user/file.ts?query=1");
  });
});

describe("filePathToUri", () => {
  it("should convert local path to file:// URI", () => {
    expect(filePathToUri("/home/user/file.ts"))
      .toBe("file:///home/user/file.ts");
  });

  it("should encode special characters in URI", () => {
    expect(filePathToUri("/home/my docs/file.ts"))
      .toBe("file:///home/my%20docs/file.ts");
  });

  it("should encode spaces correctly", () => {
    expect(filePathToUri("/path/with spaces/file.ts"))
      .toContain("%20");
  });
});

// ── sanitizeError ───────────────────────────────────────────────────────────

describe("sanitizeError", () => {
  it("should format Error objects with context", () => {
    const err = new Error("something went wrong");
    expect(sanitizeError(err, "Operation failed")).toBe(
      "Operation failed: something went wrong",
    );
  });

  it("should format string errors with context", () => {
    expect(sanitizeError("plain string error", "Ctx")).toBe(
      "Ctx: plain string error",
    );
  });

  it("should format non-standard thrown values", () => {
    expect(sanitizeError(42, "Bad input")).toBe("Bad input: 42");
    expect(sanitizeError(null, "Null context")).toBe("Null context: null");
    expect(sanitizeError(undefined, "Undef context")).toBe(
      "Undef context: undefined",
    );
  });

  it("should strip /home/<user> paths", () => {
    const err = new Error("Cannot read file /home/blake/secret/project/index.ts");
    const result = sanitizeError(err, "Read error");
    expect(result).toContain("~/secret/project/index.ts");
    expect(result).not.toContain("/home/blake");
  });

  it("should strip /Users/<user> paths (macOS)", () => {
    const err = new Error("Failed at /Users/john/dev/file.ts");
    const result = sanitizeError(err, "Error");
    expect(result).toContain("~/dev/file.ts");
    expect(result).not.toContain("/Users/john");
  });

  it("should strip /root/ paths", () => {
    const err = new Error("Failed at /root/project/main.py");
    const result = sanitizeError(err, "Error");
    expect(result).toContain("/project/main.py");
    expect(result).not.toContain("/root/");
  });

  it("should handle multiple path occurrences", () => {
    const err = new Error(
      "From /home/alice/a.ts to /home/alice/b.ts",
    );
    const result = sanitizeError(err, "Multi");
    expect(result).toBe("Multi: From ~/a.ts to ~/b.ts");
  });

  it("should not modify paths that do not match patterns", () => {
    const err = new Error("Error in /var/log/app.log");
    const result = sanitizeError(err, "Ctx");
    expect(result).toBe("Ctx: Error in /var/log/app.log");
  });
});

// ── parseSymbolKind ─────────────────────────────────────────────────────────

describe("parseSymbolKind", () => {
  it("should parse numeric string as SymbolKind", () => {
    expect(parseSymbolKind("5")).toBe(5); // Class
    expect(parseSymbolKind("12")).toBe(12); // Function
    expect(parseSymbolKind("13")).toBe(13); // Variable
  });

  it("should parse common kind names (case-insensitive)", () => {
    expect(parseSymbolKind("class")).toBe(5);
    expect(parseSymbolKind("Class")).toBe(5);
    expect(parseSymbolKind("CLASS")).toBe(5);
    expect(parseSymbolKind("function")).toBe(12);
    expect(parseSymbolKind("method")).toBe(6);
    expect(parseSymbolKind("property")).toBe(7);
    expect(parseSymbolKind("variable")).toBe(13);
    expect(parseSymbolKind("interface")).toBe(11);
    expect(parseSymbolKind("enum")).toBe(10);
    expect(parseSymbolKind("constant")).toBe(14);
    expect(parseSymbolKind("constructor")).toBe(9);
    expect(parseSymbolKind("namespace")).toBe(3);
    expect(parseSymbolKind("module")).toBe(2);
    expect(parseSymbolKind("field")).toBe(8);
    expect(parseSymbolKind("struct")).toBe(23);
    expect(parseSymbolKind("typeparameter")).toBe(26);
  });

  it("should return undefined for unknown names", () => {
    expect(parseSymbolKind("unknown")).toBeUndefined();
    expect(parseSymbolKind("foobar")).toBeUndefined();
  });

  it("should return undefined for out-of-range numbers", () => {
    expect(parseSymbolKind("0")).toBeUndefined();
    expect(parseSymbolKind("99")).toBeUndefined();
    expect(parseSymbolKind("-1")).toBeUndefined();
  });

  it("should return undefined for NaN-like input", () => {
    expect(parseSymbolKind("abc123")).toBeUndefined();
  });
});

// ── flattenLocations ────────────────────────────────────────────────────────

describe("flattenLocations", () => {
  const makeLocation = (uri: string, line: number, col: number) => ({
    uri,
    range: { start: { line, character: col }, end: { line, character: col + 5 } },
  });

  it("should return empty array for null", () => {
    expect(flattenLocations(null)).toEqual([]);
  });

  it("should wrap a single Location in an array", () => {
    const loc = makeLocation("file:///a.ts", 1, 0);
    expect(flattenLocations(loc)).toEqual([loc]);
  });

  it("should return an array of Locations as-is", () => {
    const locs = [
      makeLocation("file:///a.ts", 1, 0),
      makeLocation("file:///b.ts", 5, 2),
    ];
    expect(flattenLocations(locs)).toEqual(locs);
  });

  it("should return empty array for empty array", () => {
    expect(flattenLocations([])).toEqual([]);
  });
});

// ── formatLocations ─────────────────────────────────────────────────────────

describe("formatLocations", () => {
  const makeLocation = (uri: string, line: number, col: number) => ({
    uri,
    range: { start: { line, character: col }, end: { line, character: col + 5 } },
  });

  it("should return '(none)' for empty array", () => {
    expect(formatLocations([])).toBe("(none)");
  });

  it("should format a single location", () => {
    const loc = makeLocation("file:///home/user/project/src/index.ts", 5, 10);
    const result = formatLocations([loc]);
    expect(result).toContain("/home/user/project/src/index.ts:6:11");
  });

  it("should format multiple locations with one per line", () => {
    const locs = [
      makeLocation("file:///a.ts", 0, 0),
      makeLocation("file:///b.ts", 9, 3),
    ];
    const result = formatLocations(locs);
    expect(result).toContain("/a.ts:1:1");
    expect(result).toContain("/b.ts:10:4");
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("should indent each line with two spaces", () => {
    const locs = [makeLocation("file:///a.ts", 0, 0)];
    const result = formatLocations(locs);
    expect(result.startsWith("  ")).toBe(true);
  });
});

// ── countSeverities ─────────────────────────────────────────────────────────

describe("countSeverities", () => {
  it("should count errors, warnings, and info", () => {
    const diagnostics = [
      { severity: 1 }, // Error
      { severity: 1 }, // Error
      { severity: 2 }, // Warning
      { severity: 3 }, // Info
      { severity: 4 }, // Hint
    ];
    expect(countSeverities(diagnostics)).toEqual({
      errors: 2,
      warnings: 1,
      info: 2,
    });
  });

  it("should return zeros for empty array", () => {
    expect(countSeverities([])).toEqual({ errors: 0, warnings: 0, info: 0 });
  });

  it("should count all same severity", () => {
    expect(countSeverities([{ severity: 1 }, { severity: 1 }, { severity: 1 }])).toEqual({
      errors: 3,
      warnings: 0,
      info: 0,
    });
  });

  it("should treat undefined severity as not counted", () => {
    expect(countSeverities([{ severity: undefined }])).toEqual({
      errors: 0,
      warnings: 0,
      info: 0,
    });
  });

  it("should handle diagnostics without severity field", () => {
    expect(countSeverities([{}])).toEqual({ errors: 0, warnings: 0, info: 0 });
  });
});

// ── formatDiagnosticLine ────────────────────────────────────────────────────

describe("formatDiagnosticLine", () => {
  const baseDiag = {
    range: { start: { line: 4, character: 9 } },
    severity: 1,
    source: "tsc",
    message: "Type 'string' is not assignable to type 'number'.",
    code: 2322,
  };

  it("should format a full diagnostic with all fields", () => {
    const result = formatDiagnosticLine(baseDiag);
    expect(result).toBe(
      "  Error: 5:10: [tsc] Type 'string' is not assignable to type 'number'. (2322)",
    );
  });

  it("should format without source", () => {
    const result = formatDiagnosticLine({ ...baseDiag, source: undefined });
    expect(result).toBe(
      "  Error: 5:10: Type 'string' is not assignable to type 'number'. (2322)",
    );
  });

  it("should format without code", () => {
    const result = formatDiagnosticLine({ ...baseDiag, code: undefined });
    expect(result).toBe(
      "  Error: 5:10: [tsc] Type 'string' is not assignable to type 'number'.",
    );
  });

  it("should handle object-style code (LSP CodeDescription)", () => {
    const result = formatDiagnosticLine({
      ...baseDiag,
      code: { value: "https://example.com/diag/123" },
    });
    expect(result).toContain("(https://example.com/diag/123)");
  });

  it("should handle string code", () => {
    const result = formatDiagnosticLine({ ...baseDiag, code: "no-unused-vars" });
    expect(result).toContain("(no-unused-vars)");
  });

  it("should handle missing severity (defaults to '?')", () => {
    const result = formatDiagnosticLine({
      range: { start: { line: 0, character: 0 } },
      message: "Some issue",
    });
    expect(result).toContain("?: 1:1: Some issue");
  });

  it("should display Warning severity correctly", () => {
    const result = formatDiagnosticLine({ ...baseDiag, severity: 2 });
    expect(result).toContain("Warning:");
  });

  it("should display Info severity correctly", () => {
    const result = formatDiagnosticLine({ ...baseDiag, severity: 3 });
    expect(result).toContain("Info:");
  });

  it("should display Hint severity correctly", () => {
    const result = formatDiagnosticLine({ ...baseDiag, severity: 4 });
    expect(result).toContain("Hint:");
  });

  it("should start with two-space indent", () => {
    const result = formatDiagnosticLine(baseDiag);
    expect(result.startsWith("  ")).toBe(true);
  });

  it("should use 1-indexed line and column", () => {
    const result = formatDiagnosticLine({
      range: { start: { line: 0, character: 0 } },
      message: "test",
    });
    expect(result).toContain("1:1:");
  });
});

// ── isWithinWorkspace ───────────────────────────────────────────────────────

describe("isWithinWorkspace", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lsp-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return true for a file inside workspace", () => {
    const file = path.join(tmpDir, "src", "index.ts");
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(file, "");
    expect(isWithinWorkspace(file, tmpDir)).toBe(true);
  });

  it("should return true for workspace root itself", () => {
    expect(isWithinWorkspace(tmpDir, tmpDir)).toBe(true);
  });

  it("should return false for a file outside workspace", () => {
    const outsideFile = path.join(os.tmpdir(), "other-project", "file.ts");
    expect(isWithinWorkspace(outsideFile, tmpDir)).toBe(false);
  });

  it("should return true for a non-existent file inside workspace", () => {
    const file = path.join(tmpDir, "new-file.ts");
    expect(isWithinWorkspace(file, tmpDir)).toBe(true);
  });

  it("should handle symlinked files inside workspace", () => {
    const realFile = path.join(tmpDir, "real.ts");
    const linkFile = path.join(tmpDir, "link.ts");
    fs.writeFileSync(realFile, "");
    fs.symlinkSync(realFile, linkFile);
    expect(isWithinWorkspace(linkFile, tmpDir)).toBe(true);
  });

  it("should return false for symlink pointing outside workspace", () => {
    const outsideDir = path.join(os.tmpdir(), "pi-lsp-outside-");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "external.ts");
    fs.writeFileSync(outsideFile, "");
    const linkFile = path.join(tmpDir, "link-outside.ts");
    fs.symlinkSync(outsideFile, linkFile);
    expect(isWithinWorkspace(linkFile, tmpDir)).toBe(false);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("should return false for a relative path (not resolved)", () => {
    // isWithinWorkspace doesn't resolve relative paths against workspaceRoot
    const file = "src/file.ts";
    expect(isWithinWorkspace(file, tmpDir)).toBe(false);
  });
});

// ── resolveFile edge cases ──────────────────────────────────────────────────

describe("resolveFile edge cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lsp-resolve-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should throw on path traversal outside workspace via ..", () => {
    expect(() => resolveFile("../../etc/passwd", tmpDir)).toThrow(
      "Path traversal",
    );
  });

  it("should throw on .. that resolves to workspace parent (outside cwd)", () => {
    const subDir = path.join(tmpDir, "src");
    fs.mkdirSync(subDir);
    // ../file.ts from subDir resolves to tmpDir/file.ts which is outside subDir workspace
    expect(() => resolveFile("../file.ts", subDir)).toThrow("Path traversal");
  });

  it("should throw on absolute path outside workspace", () => {
    expect(() => resolveFile("/etc/passwd", tmpDir)).toThrow("Path traversal");
  });

  it("should allow absolute path within workspace", () => {
    const file = path.join(tmpDir, "hello.ts");
    const result = resolveFile(file, tmpDir);
    expect(result).toBe(file);
  });

  it("should normalize redundant slashes when subdir exists", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);
    const result = resolveFile("src///file.ts", tmpDir);
    expect(result).toBe(path.join(tmpDir, "src", "file.ts"));
  });
});

// ── toolError ───────────────────────────────────────────────────────────────

describe("toolError", () => {
  it("should build an error result with message only", () => {
    const result = toolError("Something went wrong");
    expect(result).toEqual({
      content: [{ type: "text", text: "Something went wrong" }],
      details: {},
      isError: true,
    });
  });

  it("should include details when provided", () => {
    const result = toolError("fail", { file: "a.ts", line: 5 });
    expect(result.details).toEqual({ file: "a.ts", line: 5 });
  });

  it("should always have isError: true", () => {
    const result = toolError("x");
    expect(result.isError).toBe(true);
  });

  it("should have content array with one entry", () => {
    const result = toolError("msg");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
  });
});

// ── ensureServerInstalled ───────────────────────────────────────────────────

vi.mock("../../src/language-config.js", () => ({
  LANGUAGE_SERVERS: [
    {
      language: "typescript",
      command: "typescript-language-server",
      args: ["--stdio"],
      extensions: [".ts", ".tsx"],
      detectCommand: "typescript-language-server --version",
      installCommand: "npm install -g typescript-language-server typescript",
    },
    {
      language: "unknown",
      command: "unknown-server",
      args: [],
      extensions: [".unk"],
      detectCommand: "unknown-server --version",
      installCommand: "npm install -g unknown-server",
    },
  ],
  languageFromPath: vi.fn((filePath: string) => {
    if (filePath.endsWith(".ts")) return {
      language: "typescript",
      command: "typescript-language-server",
      args: ["--stdio"],
      extensions: [".ts"],
      detectCommand: "typescript-language-server --version",
      installCommand: "npm install -g typescript-language-server typescript",
    };
    if (filePath.endsWith(".unk")) return {
      language: "unknown",
      command: "unknown-server",
      args: [],
      extensions: [".unk"],
      detectCommand: "unknown-server --version",
      installCommand: "npm install -g unknown-server",
    };
    return null;
  }),
  isServerInstalled: vi.fn(),
}));

import { isServerInstalled } from "../../src/language-config.js";

const mockedIsServerInstalled = vi.mocked(isServerInstalled);

describe("ensureServerInstalled", () => {
  const mockUi = {
    confirm: vi.fn<() => Promise<boolean>>(),
    notify: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true if server is already installed", async () => {
    mockedIsServerInstalled.mockResolvedValue(true);
    const result = await ensureServerInstalled("typescript", mockUi);
    expect(result).toBe(true);
    expect(mockUi.confirm).not.toHaveBeenCalled();
  });

  it("should return false for unknown language", async () => {
    mockedIsServerInstalled.mockResolvedValue(true);
    const result = await ensureServerInstalled("cobol", mockUi);
    expect(result).toBe(false);
  });

  it("should prompt user and return false if declined", async () => {
    mockedIsServerInstalled.mockResolvedValue(false);
    mockUi.confirm.mockResolvedValue(false);
    const result = await ensureServerInstalled("typescript", mockUi);
    expect(result).toBe(false);
    expect(mockUi.confirm).toHaveBeenCalled();
  });

  it("should install server and return true on success", async () => {
    mockedIsServerInstalled
      .mockResolvedValueOnce(false) // first check
      .mockResolvedValueOnce(true); // verification after install
    mockUi.confirm.mockResolvedValue(true);

    // Mock execFile via child_process mock
    const childProcess = await import("node:child_process");
    vi.spyOn(childProcess, "execFile").mockImplementation((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, "installed", "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {} as any;
    });

    const result = await ensureServerInstalled("typescript", mockUi);
    expect(result).toBe(true);
    expect(mockUi.notify).toHaveBeenCalledWith(
      "Installing typescript LSP server...",
      "info",
    );
    expect(mockUi.notify).toHaveBeenCalledWith(
      "typescript LSP server installed successfully.",
      "success",
    );
    vi.restoreAllMocks();
  });

  it("should handle installation failure", async () => {
    mockedIsServerInstalled.mockResolvedValue(false);
    mockUi.confirm.mockResolvedValue(true);

    const childProcess = await import("node:child_process");
    vi.spyOn(childProcess, "execFile").mockImplementation((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(new Error("npm install failed"), "", "error output");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {} as any;
    });

    const result = await ensureServerInstalled("typescript", mockUi);
    expect(result).toBe(false);
    expect(mockUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to install"),
      "error",
    );
    vi.restoreAllMocks();
  });

  it("should warn when verification fails after install", async () => {
    mockedIsServerInstalled
      .mockResolvedValueOnce(false) // first check
      .mockResolvedValueOnce(false); // verification after install
    mockUi.confirm.mockResolvedValue(true);

    const childProcess = await import("node:child_process");
    vi.spyOn(childProcess, "execFile").mockImplementation((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, "ok", "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {} as any;
    });

    const result = await ensureServerInstalled("typescript", mockUi);
    expect(result).toBe(false);
    expect(mockUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("verification failed"),
      "warning",
    );
    vi.restoreAllMocks();
  });
});

// ── executePreamble ─────────────────────────────────────────────────────────

describe("executePreamble", () => {
  const mockUi = {
    confirm: vi.fn<() => Promise<boolean>>(),
    notify: vi.fn(),
  };
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lsp-preamble-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return error when manager is null", async () => {
    const result = await executePreamble(
      "test.ts",
      tmpDir,
      () => null,
      mockUi,
    );
    if ("error" in result) {
      expect(result.error.isError).toBe(true);
      expect(result.error.content[0].text).toContain(
        "LSP manager not initialized",
      );
    } else {
      expect.unreachable("Expected error result");
    }
  });

  it("should return error for unsupported file extension", async () => {
    const result = await executePreamble(
      "test.xyz",
      tmpDir,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => ({} as any),
      mockUi,
    );
    if ("error" in result) {
      expect(result.error.isError).toBe(true);
      expect(result.error.content[0].text).toContain(
        "No LSP server configured",
      );
    } else {
      expect.unreachable("Expected error result");
    }
  });

  it("should return error when server not installed and user declines install", async () => {
    mockedIsServerInstalled.mockResolvedValue(false);
    mockUi.confirm.mockResolvedValue(false);

    const result = await executePreamble(
      "test.ts",
      tmpDir,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => ({} as any),
      mockUi,
    );
    if ("error" in result) {
      expect(result.error.isError).toBe(true);
      expect(result.error.content[0].text).toContain("not installed");
    } else {
      expect.unreachable("Expected error result");
    }
  });

  it("should return error when getClientForConfig returns null", async () => {
    mockedIsServerInstalled.mockResolvedValue(true);
    const mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue(null),
      ensureFileOpen: vi.fn(),
    };

    const result = await executePreamble(
      "test.ts",
      tmpDir,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mockManager as any,
      mockUi,
    );
    if ("error" in result) {
      expect(result.error.isError).toBe(true);
      expect(result.error.content[0].text).toContain(
        "Failed to start LSP server",
      );
    } else {
      expect.unreachable("Expected error result");
    }
  });

  it("should return ok result on success", async () => {
    mockedIsServerInstalled.mockResolvedValue(true);
    const mockClient = { name: "test-client" };
    const mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue(mockClient),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
    };

    // Create test.ts so resolveFile can verify it's within workspace
    const testFile = path.join(tmpDir, "test.ts");
    fs.writeFileSync(testFile, "");

    const result = await executePreamble(
      "test.ts",
      tmpDir,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mockManager as any,
      mockUi,
    );
    if ("ok" in result) {
      expect(result.ok.filePath).toBe(testFile);
      expect(result.ok.client).toBe(mockClient);
      expect(result.ok.uri).toContain("file://");
      expect(mockManager.ensureFileOpen).toHaveBeenCalled();
    } else {
      expect.unreachable("Expected ok result");
    }
  });
});

// ── applyEdits additional tests ─────────────────────────────────────────────

describe("applyEdits additional", () => {
  it("should handle replacement that spans entire file", () => {
    const text = "line1\nline2\nline3";
    const edits = [{
      range: { start: { line: 0, character: 0 }, end: { line: 2, character: 5 } },
      newText: "new content",
    }];
    expect(applyEdits(text, edits)).toBe("new content");
  });

  it("should handle edit at beginning of first line (sorted with other edits)", () => {
    const text = "aaa\nbbb\nccc";
    const edits = [
      {
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
        newText: "CCC",
      },
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        newText: "AAA",
      },
    ];
    expect(applyEdits(text, edits)).toBe("AAA\nbbb\nCCC");
  });

  it("should handle multi-line insertion", () => {
    const text = "line1\nline3";
    const edits = [{
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
      newText: "line2\n",
    }];
    expect(applyEdits(text, edits)).toBe("line1\nline2\nline3");
  });

  it("should handle empty string input text", () => {
    const text = "";
    const edits = [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "hello",
    }];
    expect(applyEdits(text, edits)).toBe("hello");
  });

  it("should handle insert at exact end of text (append)", () => {
    const text = "abc";
    const edits = [{
      range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } },
      newText: "def",
    }];
    expect(applyEdits(text, edits)).toBe("abcdef");
  });
});

// ── buildDiff additional tests ──────────────────────────────────────────────

describe("buildDiff additional", () => {
  it("should handle completely empty original", () => {
    const diff = buildDiff("new.ts", "", "line1\nline2");
    expect(diff).toContain("+line1");
    expect(diff).toContain("+line2");
    expect(diff).not.toContain("-line");
  });

  it("should handle completely empty modified (deletion)", () => {
    const diff = buildDiff("old.ts", "line1\nline2", "");
    expect(diff).toContain("-line1");
    expect(diff).toContain("-line2");
    expect(diff).not.toContain("+line");
  });

  it("should include file path in header", () => {
    const diff = buildDiff("src/utils/helper.ts", "a", "b");
    expect(diff).toContain("--- a/src/utils/helper.ts");
    expect(diff).toContain("+++ b/src/utils/helper.ts");
  });

  it("should include @@ hunk headers", () => {
    const diff = buildDiff("f.ts", "old", "new");
    expect(diff).toContain("@@");
  });
});
