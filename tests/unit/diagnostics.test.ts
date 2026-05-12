import { describe, it, expect, vi } from "vitest";
import { registerDiagnosticsHook } from "../../src/diagnostics.js";
import type { LspManager } from "../../src/lsp-manager.js";

function createMockPi() {
  const handlers: Record<string, Function[]> = {};
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    handlers,
  };
}

describe("registerDiagnosticsHook", () => {
  it("should register tool_result handler", () => {
    const mockPi = createMockPi() as any;
    const mockManager = {} as LspManager;

    registerDiagnosticsHook(mockPi, mockManager);

    expect(mockPi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
  });

  it("should register turn_end handler", () => {
    const mockPi = createMockPi() as any;
    const mockManager = {} as LspManager;

    registerDiagnosticsHook(mockPi, mockManager);

    expect(mockPi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));
  });

  it("should not register other handlers", () => {
    const mockPi = createMockPi() as any;
    const mockManager = {} as LspManager;

    registerDiagnosticsHook(mockPi, mockManager);

    expect(mockPi.on).toHaveBeenCalledTimes(2);
  });
});
