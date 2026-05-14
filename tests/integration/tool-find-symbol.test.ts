import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindSymbolTool } from "../../src/tools/find-symbol.js";

describe("lsp_find_symbol tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        workspaceSymbol: vi.fn().mockResolvedValue([]),
      }),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindSymbolTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "lsp_find_symbol");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("lsp_find_symbol");
  });

  it("should return error when no query provided", async () => {
    const tool = getTool(pi, "lsp_find_symbol");
    const result = await tool.execute(
      "call-1",
      { query: "" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Please provide a symbol query");
  });
});
