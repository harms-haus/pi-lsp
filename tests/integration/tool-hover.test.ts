import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerHoverTool } from "../../src/tools/hover.js";

describe("hover tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        hover: vi.fn().mockResolvedValue(null),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerHoverTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "hover");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("hover");
  });

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "hover");
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
