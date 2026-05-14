import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  describe("pi-lint status publishing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("errors+warnings → setStatus called with aggregate counts", async () => {
      const mockPi = createMockPi() as any;
      const mockManager = {
        onFileChanged: vi.fn().mockResolvedValue(undefined),
        getDiagnostics: vi.fn().mockResolvedValue([
          { severity: 1 },
          { severity: 2 },
          { severity: 2 },
        ]),
      } as unknown as LspManager;
      const setStatus = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: "/test",
        hasUI: true,
        ui: { setStatus, notify },
      };

      registerDiagnosticsHook(mockPi, mockManager);

      // Simulate a tool_result for a write on a .ts file
      await mockPi.handlers["tool_result"][0](
        { toolName: "write", input: { path: "/test/file.ts" } },
        ctx,
      );

      // Emit turn_end and flush all timers
      const turnEndPromise = mockPi.handlers["turn_end"][0]({}, ctx);
      await vi.runAllTimersAsync();
      await turnEndPromise;

      expect(setStatus).toHaveBeenCalledWith(
        "pi-lint",
        "1 error, 2 warnings",
      );
    });

    it("clean diagnostics → setStatus cleared", async () => {
      const mockPi = createMockPi() as any;
      const mockManager = {
        onFileChanged: vi.fn().mockResolvedValue(undefined),
        getDiagnostics: vi.fn().mockResolvedValue([]),
      } as unknown as LspManager;
      const setStatus = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: "/test",
        hasUI: true,
        ui: { setStatus, notify },
      };

      registerDiagnosticsHook(mockPi, mockManager);

      await mockPi.handlers["tool_result"][0](
        { toolName: "write", input: { path: "/test/file.ts" } },
        ctx,
      );

      const turnEndPromise = mockPi.handlers["turn_end"][0]({}, ctx);
      await vi.runAllTimersAsync();
      await turnEndPromise;

      expect(setStatus).toHaveBeenCalledWith("pi-lint", "✓ clean");
    });

    it("multiple files → counts are aggregated", async () => {
      const mockPi = createMockPi() as any;
      const mockManager = {
        onFileChanged: vi.fn().mockResolvedValue(undefined),
        getDiagnostics: vi.fn()
          .mockResolvedValueOnce([{ severity: 1 }, { severity: 1 }])
          .mockResolvedValueOnce([{ severity: 2 }]),
      } as unknown as LspManager;
      const setStatus = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: "/test",
        hasUI: true,
        ui: { setStatus, notify },
      };

      registerDiagnosticsHook(mockPi, mockManager);

      // Simulate two modified .ts files
      await mockPi.handlers["tool_result"][0](
        { toolName: "write", input: { path: "/test/a.ts" } },
        ctx,
      );
      await mockPi.handlers["tool_result"][0](
        { toolName: "write", input: { path: "/test/b.ts" } },
        ctx,
      );

      const turnEndPromise = mockPi.handlers["turn_end"][0]({}, ctx);
      await vi.runAllTimersAsync();
      await turnEndPromise;

      expect(setStatus).toHaveBeenCalledWith(
        "pi-lint",
        "2 errors, 1 warning",
      );
    });

    it("no modified files → setStatus not called", async () => {
      const mockPi = createMockPi() as any;
      const mockManager = {
        onFileChanged: vi.fn().mockResolvedValue(undefined),
        getDiagnostics: vi.fn().mockResolvedValue([]),
      } as unknown as LspManager;
      const setStatus = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: "/test",
        hasUI: true,
        ui: { setStatus, notify },
      };

      registerDiagnosticsHook(mockPi, mockManager);

      // Emit turn_end without any prior tool_result for write/edit
      const turnEndPromise = mockPi.handlers["turn_end"][0]({}, ctx);
      await vi.runAllTimersAsync();
      await turnEndPromise;

      expect(setStatus).not.toHaveBeenCalled();
    });

    it("errors only → status shows errors without warnings", async () => {
      const mockPi = createMockPi() as any;
      const mockManager = {
        onFileChanged: vi.fn().mockResolvedValue(undefined),
        getDiagnostics: vi.fn().mockResolvedValue([
          { severity: 1 },
          { severity: 1 },
        ]),
      } as unknown as LspManager;
      const setStatus = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: "/test",
        hasUI: true,
        ui: { setStatus, notify },
      };

      registerDiagnosticsHook(mockPi, mockManager);

      await mockPi.handlers["tool_result"][0](
        { toolName: "write", input: { path: "/test/file.ts" } },
        ctx,
      );

      const turnEndPromise = mockPi.handlers["turn_end"][0]({}, ctx);
      await vi.runAllTimersAsync();
      await turnEndPromise;

      expect(setStatus).toHaveBeenCalledWith("pi-lint", "2 errors");
      expect(notify).toHaveBeenCalledWith("file.ts: 2 errors", "error");
    });

    it("warnings only → status shows warnings without errors", async () => {
      const mockPi = createMockPi() as any;
      const mockManager = {
        onFileChanged: vi.fn().mockResolvedValue(undefined),
        getDiagnostics: vi.fn().mockResolvedValue([{ severity: 2 }]),
      } as unknown as LspManager;
      const setStatus = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: "/test",
        hasUI: true,
        ui: { setStatus, notify },
      };

      registerDiagnosticsHook(mockPi, mockManager);

      await mockPi.handlers["tool_result"][0](
        { toolName: "write", input: { path: "/test/file.ts" } },
        ctx,
      );

      const turnEndPromise = mockPi.handlers["turn_end"][0]({}, ctx);
      await vi.runAllTimersAsync();
      await turnEndPromise;

      expect(setStatus).toHaveBeenCalledWith("pi-lint", "1 warning");
      expect(notify).toHaveBeenCalledWith("file.ts: 1 warning", "warning");
    });

    it("per-file notify uses correct pluralization", async () => {
      const mockPi = createMockPi() as any;
      const mockManager = {
        onFileChanged: vi.fn().mockResolvedValue(undefined),
        getDiagnostics: vi.fn().mockResolvedValue([
          { severity: 1 },
          { severity: 2 },
        ]),
      } as unknown as LspManager;
      const setStatus = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: "/test",
        hasUI: true,
        ui: { setStatus, notify },
      };

      registerDiagnosticsHook(mockPi, mockManager);

      await mockPi.handlers["tool_result"][0](
        { toolName: "write", input: { path: "/test/file.ts" } },
        ctx,
      );

      const turnEndPromise = mockPi.handlers["turn_end"][0]({}, ctx);
      await vi.runAllTimersAsync();
      await turnEndPromise;

      expect(notify).toHaveBeenCalledWith(
        "file.ts: 1 error, 1 warning",
        "error",
      );
    });
  });
});
