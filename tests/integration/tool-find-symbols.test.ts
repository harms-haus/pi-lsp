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

    expect(result.isError).not.toBe(true);
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

    expect(result.isError).not.toBe(true);
    expect(result.details.count).toBe(1);
    expect(result.content[0].text).toContain("MyClass");
    expect(result.content[0].text).not.toContain("helper");
  });

  it("should show warning when invalid kind is provided", async () => {
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
      { query: "test", kind: "nonexistent_kind" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    // Should show all results since kind is invalid
    expect(result.content[0].text).toContain("MyClass");
    expect(result.content[0].text).toContain("helper");
    expect(result.content[0].text).toContain("not a valid symbol kind");
    expect(result.details.count).toBe(2);
  });

  it("should return error when no server available", async () => {
    // Re-register with a getCwd that returns a real directory
    const piLocal = createMockExtensionApi();
    const localManager = {
      getClientForConfig: vi.fn().mockResolvedValue(null),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindSymbolsTool(piLocal as any, () => localManager as any, () => "/tmp");

    // Mock execFile to fail for all isServerInstalled checks
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(new Error("not found"), "", "");
      return { kill: vi.fn() } as any;
    });

    const tool = getTool(piLocal, "find_symbols");
    const result = await tool.execute(
      "call-1",
      { query: "test" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/tmp" } as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No LSP server running");
  });
});
