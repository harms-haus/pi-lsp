import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerDiagnosticsTool } from "../../src/tools/diagnostics.js";

describe("lsp_diagnostics tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: Partial<import("../../src/lsp-manager.js").LspManager>;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getDiagnostics: vi.fn().mockResolvedValue([]),
      getClientForConfig: vi.fn(),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerDiagnosticsTool(pi as any, () => mockManager as any, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "lsp_diagnostics");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("lsp_diagnostics");
  });

  it("should return formatted diagnostics on success", async () => {
    // Mock execFile to respond for isServerInstalled (called inside executePreamble)
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    // Mock diagnostics with errors and warnings
    vi.mocked(mockManager.getDiagnostics as ReturnType<typeof vi.fn>).mockResolvedValue([
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } }, severity: 1, message: "Unexpected token" },
      { range: { start: { line: 5, character: 1 }, end: { line: 5, character: 3 } }, severity: 2, message: "Unused variable" },
    ] as any[]);
    vi.mocked(mockManager.getClientForConfig as ReturnType<typeof vi.fn>).mockReturnValue({});
    vi.mocked(mockManager.ensureFileOpen as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const tool = getTool(pi, "lsp_diagnostics")!;
    const result = await tool.execute(
      "call-1",
      { file: "test.ts" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    // Should not be an error result
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("1 error(s), 1 warning(s)");
  });

  it("should have correct label and description", () => {
    const tool = getTool(pi, "lsp_diagnostics")!;
    expect(tool!.label).toBe("LSP Diagnostics");
    expect(tool!.description).toContain("Run LSP diagnostics");
  });

  describe("workspace mode", () => {
    it("should return workspace diagnostics", async () => {
      // Build a Map with mixed severity diagnostics
      const diagMap = new Map<string, any[]>();
      diagMap.set("file:///test/src/a.ts", [
        { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } }, severity: 1, message: "Error in a" },
        { range: { start: { line: 3, character: 1 }, end: { line: 3, character: 4 } }, severity: 2, message: "Warning in a" },
      ]);
      diagMap.set("file:///test/src/b.ts", [
        { range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } }, severity: 3, message: "Info in b" },
      ]);

      mockManager.getAllDiagnostics = vi.fn().mockReturnValue(diagMap);

      const tool = getTool(pi, "lsp_diagnostics")!;
      const result = await tool.execute(
        "call-ws-1",
        { workspace: true },
        undefined,
        undefined,
        { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
      );

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("Workspace diagnostics");
      expect(text).toContain("2 file(s)");
      expect(text).toContain("1 error(s), 1 warning(s), 1 info");
      expect(text).toContain("Error in a");
      expect(text).toContain("Warning in a");
      expect(text).toContain("Info in b");
      expect(result.details.workspace).toBe(true);
      expect(result.details.fileCount).toBe(2);
      expect(result.details.errorCount).toBe(1);
      expect(result.details.warningCount).toBe(1);
      expect(result.details.infoCount).toBe(1);
    });

    it("should return message when no workspace diagnostics available", async () => {
      mockManager.getAllDiagnostics = vi.fn().mockReturnValue(new Map());

      const tool = getTool(pi, "lsp_diagnostics")!;
      const result = await tool.execute(
        "call-ws-2",
        { workspace: true },
        undefined,
        undefined,
        { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
      );

      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain("No diagnostics available");
      expect(result.details.fileCount).toBe(0);
      expect(result.details.total).toBe(0);
    });

    it("should return error when workspace mode with null manager", async () => {
      // Re-register with a getManager that returns null
      const piNull = createMockExtensionApi();
      registerDiagnosticsTool(piNull as any, () => null, () => "/test/cwd");

      const tool = getTool(piNull, "lsp_diagnostics")!;
      const result = await tool.execute(
        "call-ws-3",
        { workspace: true },
        undefined,
        undefined,
        { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("LSP manager not initialized");
    });
  });

  it("should return error when neither file nor workspace specified", async () => {
    const tool = getTool(pi, "lsp_diagnostics")!;
    const result = await tool.execute(
      "call-no-args",
      {},
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No file or workspace mode specified");
  });

  it("should return no issues found when file has no diagnostics", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    vi.mocked(mockManager.getDiagnostics as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.mocked(mockManager.getClientForConfig as ReturnType<typeof vi.fn>).mockReturnValue({});
    vi.mocked(mockManager.ensureFileOpen as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const tool = getTool(pi, "lsp_diagnostics")!;
    const result = await tool.execute(
      "call-clean",
      { file: "test.ts" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("No issues found");
    expect(result.details.errorCount).toBe(0);
    expect(result.details.warningCount).toBe(0);
  });
});
