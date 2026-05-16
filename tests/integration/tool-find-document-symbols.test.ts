import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockExtensionApi, getTool } from "../helpers/mock-extension-api.js";
import { registerFindDocumentSymbolsTool } from "../../src/tools/find_document_symbols.js";

describe("find_document_symbols tool integration", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;
  let mockManager: any;

  beforeEach(() => {
    pi = createMockExtensionApi();
    mockManager = {
      getClientForConfig: vi.fn().mockResolvedValue({
        documentSymbol: vi.fn().mockResolvedValue([]),
      }),
      ensureFileOpen: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getClientMap: vi.fn().mockReturnValue(new Map()),
    };
    registerFindDocumentSymbolsTool(pi as any, () => mockManager, () => "/test/cwd");
  });

  it("should register tool with correct name", () => {
    const tool = getTool(pi, "find_document_symbols");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("find_document_symbols");
  });

  it("should return formatted document symbols on success", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      documentSymbol: vi.fn().mockResolvedValue([
        { name: "MyClass", kind: 5, range: { start: { line: 0, character: 0 }, end: { line: 20, character: 1 } }, children: [
          { name: "constructor", kind: 9, range: { start: { line: 3, character: 2 }, end: { line: 5, character: 3 } }, children: [] },
          { name: "myMethod", kind: 6, range: { start: { line: 7, character: 2 }, end: { line: 12, character: 3 } }, children: [] },
        ] },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_document_symbols");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Document symbols for");
    expect(result.content[0].text).toContain("MyClass");
    expect(result.content[0].text).toContain("myMethod");
    expect(result.details.count).toBe(3); // MyClass + constructor + myMethod
  });

  it("should handle SymbolInformation[] format", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    // SymbolInformation format: has `location` property, no `children` property
    const mockClient = {
      documentSymbol: vi.fn().mockResolvedValue([
        { name: "myFunction", kind: 12, location: { uri: "file:///test/test.ts", range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } } } },
        { name: "MyClass", kind: 5, location: { uri: "file:///test/test.ts", range: { start: { line: 15, character: 0 }, end: { line: 30, character: 1 } } } },
      ]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_document_symbols");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Document symbols for");
    expect(result.content[0].text).toContain("myFunction");
    expect(result.content[0].text).toContain("MyClass");
    // SymbolInformation format uses 2-space indent (no hierarchical nesting)
    expect(result.content[0].text).toContain("  Function myFunction (line 6)");
    expect(result.content[0].text).toContain("  Class MyClass (line 16)");
    expect(result.details.count).toBe(2);
  });

  it("should return no symbols found when result is empty", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      documentSymbol: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_document_symbols");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("No symbols found");
    expect(result.details.count).toBe(0);
  });

  it("should return no symbols found when result is null", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const mockClient = {
      documentSymbol: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(mockManager.getClientForConfig as any).mockResolvedValue(mockClient);
    vi.mocked(mockManager.ensureFileOpen as any).mockResolvedValue(undefined);

    const tool = getTool(pi, "find_document_symbols");
    const result = await tool.execute(
      "call-1",
      { file: "test.ts" },
      undefined,
      undefined,
      { ui: { confirm: vi.fn(), notify: vi.fn() }, cwd: "/test" } as any,
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("No symbols found");
    expect(result.details.count).toBe(0);
  });
});
