import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindCallsTool } from "../../src/tools/find_calls.js";

describe("find_calls tool integration", () => {
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
    registerFindCallsTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_calls");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_calls");
  });

  it("should return error for unsupported file type", async () => {
    const tool = getTool(pi, "find_calls");
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
    registerFindCallsTool(pi as any, () => null, () => "/test/cwd");
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
    const tool = getTool(pi, "find_calls");
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

  it("should return formatted call hierarchy on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const hierarchyItem = {
      name: "myFunction",
      kind: 6,
      uri: "file:///test/src/test.ts",
      range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
    };
    const mockClient = {
      prepareCallHierarchy: vi.fn().mockResolvedValue([hierarchyItem]),
      incomingCalls: vi.fn().mockResolvedValue([
        { from: { name: "callerA", uri: "file:///test/src/a.ts", range: { start: { line: 10, character: 0 } } }, fromRanges: [{ start: { line: 10, character: 0 } }] },
      ]),
      outgoingCalls: vi.fn().mockResolvedValue([
        { to: { name: "helperFn", uri: "file:///test/src/utils.ts", range: { start: { line: 3, character: 0 } } }, fromRanges: [{ start: { line: 2, character: 5 } }] },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_calls");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts", line: 1, column: 1 },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Call hierarchy for");
    expect(result.content[0].text).toContain("myFunction");
    expect(result.content[0].text).toContain("Incoming Calls (1)");
    expect(result.content[0].text).toContain("Outgoing Calls (1)");
    expect(result.details.incomingCount).toBe(1);
    expect(result.details.outgoingCount).toBe(1);
  });
});
