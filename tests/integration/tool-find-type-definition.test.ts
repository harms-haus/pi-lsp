import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindTypeDefinitionTool } from "../../src/tools/find_type_definition.js";

describe("find_type_definition tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        findTypeDefinition: vi.fn().mockResolvedValue([]),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindTypeDefinitionTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_type_definition");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_type_definition");
  });

  it("should return formatted type definitions on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      findTypeDefinition: vi.fn().mockResolvedValue([
        { uri: "file:///test/src/types.ts", range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } } },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_type_definition");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Type definition found: 1 location(s)");
    expect(result.details.count).toBe(1);
    expect(result.details.locations).toHaveLength(1);
  });
});
