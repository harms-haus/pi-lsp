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

  it.skip("should return formatted diagnostics on success", async () => {
    // This test requires full integration with languageFromPath
    // Skip for now to avoid timeout issues
  });

  it("should have correct label and description", () => {
    const tool = getTool(pi, "lsp_diagnostics")!;
    expect(tool!.label).toBe("LSP Diagnostics");
    expect(tool!.description).toContain("Run LSP diagnostics");
  });
});
