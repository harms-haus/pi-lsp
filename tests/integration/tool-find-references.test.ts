import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindReferencesTool } from "../../src/tools/find_references.js";

describe("find_references tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        findReferences: vi.fn().mockResolvedValue([]),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindReferencesTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_references");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_references");
  });

  it("should return formatted references on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      findReferences: vi.fn().mockResolvedValue([
        { uri: "file:///test/src/a.ts", range: { start: { line: 2, character: 5 }, end: { line: 2, character: 10 } } },
        { uri: "file:///test/src/b.ts", range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } } },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_references");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("References found: 2");
    expect(result.details.count).toBe(2);
    expect(result.details.references).toHaveLength(2);
  });
});
