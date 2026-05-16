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

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "lsp_diagnostics")!;
    const result = await tool.execute(
      "call-1",
      { file: "data.csv" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No LSP server configured");
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
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("1 error(s), 1 warning(s)");
  });

  it("should have correct label and description", () => {
    const tool = getTool(pi, "lsp_diagnostics")!;
    expect(tool!.label).toBe("LSP Diagnostics");
    expect(tool!.description).toContain("Run LSP diagnostics");
  });
});
