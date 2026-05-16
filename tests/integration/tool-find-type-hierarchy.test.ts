import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindTypeHierarchyTool } from "../../src/tools/find_type_hierarchy.js";

describe("find_type_hierarchy tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        prepareTypeHierarchy: vi.fn().mockResolvedValue(null),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindTypeHierarchyTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_type_hierarchy");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_type_hierarchy");
  });




  it("should return formatted type hierarchy on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const hierarchyItem = {
      name: "MyClass",
      kind: 5,
      uri: "file:///test/src/test.ts",
      range: { start: { line: 0, character: 0 } },
    };
    const mockClient = {
      prepareTypeHierarchy: vi.fn().mockResolvedValue([hierarchyItem]),
      typeHierarchySupertypes: vi.fn().mockResolvedValue([
        { name: "BaseClass", kind: 5, uri: "file:///test/src/base.ts", range: { start: { line: 2, character: 0 } } },
      ]),
      typeHierarchySubtypes: vi.fn().mockResolvedValue([
        { name: "ChildClass", kind: 5, uri: "file:///test/src/child.ts", range: { start: { line: 1, character: 0 } } },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_type_hierarchy");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Type hierarchy for");
    expect(result.content[0].text).toContain("MyClass");
    expect(result.content[0].text).toContain("Supertypes (1)");
    expect(result.content[0].text).toContain("BaseClass");
    expect(result.content[0].text).toContain("Subtypes (1)");
    expect(result.content[0].text).toContain("ChildClass");
    expect(result.details.supported).toBe(true);
  });

  it("should return unsupported message when prepareTypeHierarchy returns null", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      prepareTypeHierarchy: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_type_hierarchy");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("not supported");
    expect(result.details.supported).toBe(false);
  });
});
