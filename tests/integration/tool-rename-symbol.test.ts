import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerRenameSymbolTool } from "../../src/tools/rename_symbol.js";

// Mock node:fs so we can control realpathSync and readFileSync
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    realpathSync: vi.fn((p: string) => p as string),
    readFileSync: vi.fn(),
  };
});

/** Helper to mock execFile for isServerInstalled (returns success). */
async function mockExecFileSuccess() {
  const { execFile } = await import("node:child_process");
  vi.mocked(execFile).mockImplementation(
    (_cmd: string, _args: string[], options: any, callback?: any) => {
      const cb = (typeof options === "function" ? options : callback) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    },
  );
}

describe("rename_symbol tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReturnValue("const x = 1;");
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        prepareRename: vi.fn().mockResolvedValue(null),
        rename: vi.fn().mockResolvedValue({}),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerRenameSymbolTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "rename_symbol");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("rename_symbol");
  });

  // ── Happy path: documentChanges format ──────────────────────────────────

  it("should rename a symbol using documentChanges format", async () => {
    await mockExecFileSuccess();

    const mockClient = {
      prepareRename: vi.fn().mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        placeholder: "x",
      }),
      rename: vi.fn().mockResolvedValue({
        documentChanges: [
          {
            textDocument: { uri: "file:///test/cwd/test.ts" },
            edits: [
              {
                range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
                newText: "newName",
              },
            ],
          },
        ],
      }),
    };
    vi.mocked(mockManager.getClientForConfig).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen).mockResolvedValue(undefined);

    const tool = getTool(pi, "rename_symbol");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 7, newName: "newName" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() } } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('Rename "x" → "newName"');
    expect(result.content[0].text).toContain("Files affected: 1");
    expect(result.content[0].text).toContain("newName");
    expect(result.details.fileCount).toBe(1);
    expect(result.details.oldName).toBe("x");
    expect(result.details.newName).toBe("newName");
    expect(result.details.patch).toContain("newName");

    // Verify prepareRename was called with 0-indexed coordinates
    expect(mockClient.prepareRename).toHaveBeenCalledWith(
      expect.any(String),
      0, // line 1 - 1
      6, // column 7 - 1
    );
    // Verify rename was called with the new name
    expect(mockClient.rename).toHaveBeenCalledWith(
      expect.any(String),
      0,
      6,
      "newName",
    );
  });

  // ── Happy path: legacy changes format ───────────────────────────────────

  it("should rename a symbol using legacy changes format", async () => {
    await mockExecFileSuccess();

    const mockClient = {
      prepareRename: vi.fn().mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        placeholder: "x",
      }),
      rename: vi.fn().mockResolvedValue({
        changes: {
          "file:///test/cwd/test.ts": [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
              newText: "newName",
            },
          ],
        },
      }),
    };
    vi.mocked(mockManager.getClientForConfig).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen).mockResolvedValue(undefined);

    const tool = getTool(pi, "rename_symbol");
    const result = await tool.execute(
      "call-2",
      { file: "test.ts", line: 1, column: 7, newName: "newName" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() } } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('Rename "x" → "newName"');
    expect(result.content[0].text).toContain("Files affected: 1");
    expect(result.details.fileCount).toBe(1);
    expect(result.details.oldName).toBe("x");
    expect(result.details.newName).toBe("newName");
    expect(result.details.patch).toContain("newName");
  });

  // ── Skip files outside workspace ────────────────────────────────────────

  it("should skip files outside the workspace", async () => {
    await mockExecFileSuccess();

    const mockClient = {
      prepareRename: vi.fn().mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        placeholder: "x",
      }),
      rename: vi.fn().mockResolvedValue({
        documentChanges: [
          {
            textDocument: { uri: "file:///etc/passwd" },
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                newText: "newName",
              },
            ],
          },
        ],
      }),
    };
    vi.mocked(mockManager.getClientForConfig).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen).mockResolvedValue(undefined);

    const tool = getTool(pi, "rename_symbol");
    const result = await tool.execute(
      "call-3",
      { file: "test.ts", line: 1, column: 7, newName: "newName" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() } } as any,
    );

    expect(result.isError).not.toBe(true);
    // All files are outside workspace, so fileCount should be 0
    expect(result.details.fileCount).toBe(0);
    expect(result.details.patch).toContain("skipped");
    expect(result.details.patch).toContain("outside workspace");
  });

  // ── Error during rename ─────────────────────────────────────────────────

  it("should return error when client.rename throws", async () => {
    await mockExecFileSuccess();

    const mockClient = {
      prepareRename: vi.fn().mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        placeholder: "x",
      }),
      rename: vi.fn().mockRejectedValue(new Error("rename failed catastrophically")),
    };
    vi.mocked(mockManager.getClientForConfig).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen).mockResolvedValue(undefined);

    const tool = getTool(pi, "rename_symbol");
    const result = await tool.execute(
      "call-4",
      { file: "test.ts", line: 1, column: 7, newName: "newName" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() } } as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to rename symbol");
    expect(result.content[0].text).toContain("rename failed catastrophically");
    expect(result.details.file).toBe("test.ts");
  });

  // ── prepareRename returns null → fallback to word extraction ────────────

  it("should fall back to word extraction when prepareRename returns null", async () => {
    await mockExecFileSuccess();

    // Set readFileSync to return content with "myVar" for the word extraction fallback
    vi.mocked(fs.readFileSync).mockReturnValue("const myVar = 1;");

    const mockClient = {
      prepareRename: vi.fn().mockResolvedValue(null),
      rename: vi.fn().mockResolvedValue({
        documentChanges: [
          {
            textDocument: { uri: "file:///test/cwd/test.ts" },
            edits: [
              {
                range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
                newText: "newVar",
              },
            ],
          },
        ],
      }),
    };
    vi.mocked(mockManager.getClientForConfig).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen).mockResolvedValue(undefined);

    const tool = getTool(pi, "rename_symbol");
    const result = await tool.execute(
      "call-5",
      { file: "test.ts", line: 1, column: 9, newName: "newVar" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() } } as any,
    );

    expect(result.isError).not.toBe(true);
    // When prepareRename returns null, oldName is extracted from the file at the cursor position
    // Column 9 (1-indexed) = character 8 (0-indexed), which is inside "myVar"
    // The fallback extracts the word at cursor: "myVar"
    expect(result.details.oldName).toBe("myVar");
    expect(result.details.newName).toBe("newVar");
    expect(result.details.fileCount).toBe(1);
    expect(result.content[0].text).toContain('Rename "myVar" → "newVar"');
  });
});
