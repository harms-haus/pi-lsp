import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerRenameSymbolTool } from "../../src/tools/rename_symbol.js";

describe("rename_symbol tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
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

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "rename_symbol");
    const result = await tool.execute(
      "call-1",
      { file: "data.csv", line: 1, column: 1, newName: "newName" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
  });
});
