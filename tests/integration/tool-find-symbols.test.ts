import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindSymbolsTool } from "../../src/tools/find_symbols.js";

describe("find_symbols tool integration", () => {
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
    registerFindSymbolsTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_symbols");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_symbols");
  });

  it("should return error when no query provided", async () => {
    const tool = getTool(pi, "find_symbols");
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

  it("should return error when manager is not initialized", async () => {
    registerFindSymbolsTool(pi as any, () => null, () => "/test/cwd");
    const lastTool = pi.tools[pi.tools.length - 1];
    const result = await lastTool.execute(
      "call-1",
      { query: "MyClass" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("LSP manager not initialized");
  });

  it("should return formatted symbols on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      workspaceSymbol: vi.fn().mockResolvedValue([
        { name: "MyClass", kind: 5, location: { uri: "file:///test/src/index.ts", range: { start: { line: 9, character: 0 } } }, containerName: "" },
        { name: "helper", kind: 12, location: { uri: "file:///test/src/utils.ts", range: { start: { line: 3, character: 5 } } }, containerName: "" },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);

    const tool = getTool(pi, "find_symbols");
    const result = await tool.execute(
      "call-1",
      { query: "My" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Symbols matching");
    expect(result.content[0].text).toContain("MyClass");
    expect(result.details.count).toBe(2);
  });

  it("should filter symbols by kind", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      workspaceSymbol: vi.fn().mockResolvedValue([
        { name: "MyClass", kind: 5, location: { uri: "file:///test/src/index.ts", range: { start: { line: 9, character: 0 } } }, containerName: "" },
        { name: "helper", kind: 12, location: { uri: "file:///test/src/utils.ts", range: { start: { line: 3, character: 5 } } }, containerName: "" },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);

    const tool = getTool(pi, "find_symbols");
    const result = await tool.execute(
      "call-1",
      { query: "My", kind: "class" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.count).toBe(1);
    expect(result.content[0].text).toContain("MyClass");
    expect(result.content[0].text).not.toContain("helper");
  });
});
