import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerCallHierarchyTool } from "../../src/tools/call-hierarchy.js";

describe("lsp_call_hierarchy tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        prepareCallHierarchy: vi.fn().mockResolvedValue([]),
        incomingCalls: vi.fn().mockResolvedValue([]),
        outgoingCalls: vi.fn().mockResolvedValue([]),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerCallHierarchyTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "lsp_call_hierarchy");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("lsp_call_hierarchy");
  });

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "lsp_call_hierarchy");
    const result = await tool.execute(
      "call-1",
      { file: "data.csv", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
  });
});
