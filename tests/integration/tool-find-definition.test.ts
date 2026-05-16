import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindDefinitionTool } from "../../src/tools/find_definition.js";

describe("find_definition tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        gotoDefinition: vi.fn().mockResolvedValue([]),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindDefinitionTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_definition");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_definition");
  });

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "find_definition");
    const result = await tool.execute(
      "call-1",
      { file: "data.csv", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
  });

  it("should return error when manager is not initialized", async () => {
    registerFindDefinitionTool(pi as any, () => null, () => "/test/cwd");
    const lastTool = pi.tools[pi.tools.length - 1];
    const result = await lastTool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("LSP manager not initialized");
  });

  it("should return error when server not installed and user declines", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(new Error("not found"), "", "command not found");
      return { kill: vi.fn() } as any;
    });
    const confirmMock = vi.fn().mockResolvedValue(false);
    const tool = getTool(pi, "find_definition");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: confirmMock, notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not installed");
  });

  it("should return formatted definitions on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      gotoDefinition: vi.fn().mockResolvedValue([
        { uri: "file:///test/src/defs.ts", range: { start: { line: 15, character: 0 }, end: { line: 15, character: 8 } } },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_definition");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 5, column: 3 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Definition found: 1 location(s)");
    expect(result.details.definitions).toHaveLength(1);
    expect(result.details.count).toBe(1);
  });
});
