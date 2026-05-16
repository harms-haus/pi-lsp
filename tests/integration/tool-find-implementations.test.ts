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

  it("should return error when manager is not initialized", async () => {
    registerFindImplementationsTool(pi as any, () => null, () => "/test/cwd");
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
    const tool = getTool(pi, "find_implementations");
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

  it("should return formatted implementations on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      findImplementations: vi.fn().mockResolvedValue([
        { uri: "file:///test/src/implA.ts", range: { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } } },
        { uri: "file:///test/src/implB.ts", range: { start: { line: 7, character: 5 }, end: { line: 7, character: 15 } } },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_implementations");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Implementations found: 2");
    expect(result.details.count).toBe(2);
    expect(result.details.implementations).toHaveLength(2);
  });
});
