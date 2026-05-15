import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindImplementationsTool } from "../../src/tools/find_implementations.js";

describe("find_implementations tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        findImplementations: vi.fn().mockResolvedValue([]),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindImplementationsTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_implementations");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_implementations");
  });

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "find_implementations");
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
