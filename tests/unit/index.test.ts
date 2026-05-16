import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock LspManager before importing the extension entry point
vi.mock("../../src/lsp-manager.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  const MockManager = vi.fn(function (this: any, _cwd: string, _timeout: number) {
    this.stopAll = vi.fn().mockResolvedValue(undefined);
    this.getStatus = vi.fn().mockReturnValue([]);
    this.getClientMap = vi.fn().mockReturnValue(new Map());
  });
  return {
    LspManager: MockManager,
    DEFAULT_IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  };
});

// Mock diagnostics hook (no-op) to avoid side effects
vi.mock("../../src/diagnostics.js", () => ({
  registerDiagnosticsHook: vi.fn(),
}));

import { LspManager } from "../../src/lsp-manager.js";
import { createMockExtensionApi } from "../helpers/mock-extension-api.js";

// Import the default export (the extension function) dynamically
// since we need the mocks in place first
const extensionModule = await import("../../src/index.js");
const extension = extensionModule.default;

const MockedLspManager = vi.mocked(LspManager);

describe("extension entry point (index.ts)", () => {
  let pi: ReturnType<typeof createMockExtensionApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    pi = createMockExtensionApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock API matches the real ExtensionAPI shape
    extension(pi as any);
  });

  // ── Tool Registration ──────────────────────────────────────────────────

  describe("tool registration", () => {
    it("should register exactly 11 tools", () => {
      expect(pi.tools).toHaveLength(11);
    });

    it("should register all expected tool names", () => {
      const expectedNames = [
        "lsp_diagnostics",
        "find_references",
        "find_definition",
        "find_symbols",
        "find_calls",
        "rename_symbol",
        "find_document_symbols",
        "hover",
        "find_implementations",
        "find_type_definition",
        "find_type_hierarchy",
      ];
      const registeredNames = pi.tools.map((t) => t.name).sort();
      expect(registeredNames).toEqual(expectedNames.sort());
    });
  });

  // ── session_start ──────────────────────────────────────────────────────

  describe("session_start handler", () => {
    it("should initialize LspManager with cwd", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      // Trigger session_start
      const handlers = pi.eventHandlers["session_start"];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({}, ctx);

      expect(MockedLspManager).toHaveBeenCalledWith(
        "/test/project",
        5 * 60 * 1000,
      );
    });

    it("should notify UI when hasUI is true", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: true,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      const handlers = pi.eventHandlers["session_start"];
      await handlers[0]({}, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith("pi-lsp extension loaded", "info");
    });

    it("should not notify UI when hasUI is false", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      const handlers = pi.eventHandlers["session_start"];
      await handlers[0]({}, ctx);

      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });

    it("should only create manager once across multiple session_start calls", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      const handlers = pi.eventHandlers["session_start"];
      await handlers[0]({}, ctx);
      await handlers[0]({}, ctx);

      // LspManager constructor called only once
      expect(MockedLspManager).toHaveBeenCalledTimes(1);
    });
  });

  // ── session_shutdown ───────────────────────────────────────────────────

  describe("session_shutdown handler", () => {
    it("should call stopAll on manager", async () => {
      // Start session first
      const startCtx = {
        cwd: "/test/project",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };
      await pi.eventHandlers["session_start"][0]({}, startCtx);

      const mockInstance = MockedLspManager.mock.instances[0];
      const shutdownHandlers = pi.eventHandlers["session_shutdown"];
      expect(shutdownHandlers).toBeDefined();

      await shutdownHandlers[0]({});

      expect(mockInstance.stopAll).toHaveBeenCalled();
    });

    it("should clear UI status when context has UI", async () => {
      const startCtx = {
        cwd: "/test/project",
        hasUI: true,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };
      await pi.eventHandlers["session_start"][0]({}, startCtx);

      await pi.eventHandlers["session_shutdown"][0]({});

      expect(startCtx.ui.setStatus).toHaveBeenCalledWith("pi-lsp", undefined);
      expect(startCtx.ui.setStatus).toHaveBeenCalledWith("pi-lint", undefined);
    });

    it("should handle shutdown when no manager exists", async () => {
      // No session started — no manager
      const shutdownHandlers = pi.eventHandlers["session_shutdown"];
      await expect(shutdownHandlers[0]({})).resolves.toBeUndefined();
    });
  });

  // ── publishLspStatus ───────────────────────────────────────────────────

  describe("publishLspStatus (via tool_result)", () => {
    it("should set status to running languages when servers are running", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: true,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      // Start session
      await pi.eventHandlers["session_start"][0]({}, ctx);

      const mockInstance = MockedLspManager.mock.instances[0];
      mockInstance.getStatus.mockReturnValue([
        { language: "typescript", status: "running", pid: 1234 },
        { language: "python", status: "running", pid: 5678 },
      ]);

      // Trigger tool_result
      await pi.eventHandlers["tool_result"][0]({}, ctx);

      expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-lsp", "typescript, python");
    });

    it("should clear status when no servers are running", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: true,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      await pi.eventHandlers["session_start"][0]({}, ctx);

      const mockInstance = MockedLspManager.mock.instances[0];

      // First set status to something non-undefined so we can test clearing
      mockInstance.getStatus.mockReturnValue([
        { language: "typescript", status: "running", pid: 1234 },
      ]);
      await pi.eventHandlers["tool_result"][0]({}, ctx);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-lsp", "typescript");

      // Now return no running servers
      mockInstance.getStatus.mockReturnValue([
        { language: "typescript", status: "stopped", pid: null },
      ]);
      await pi.eventHandlers["tool_result"][0]({}, ctx);

      // Status should be set to undefined (no running servers)
      expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-lsp", undefined);
    });

    it("should not update status if unchanged", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: true,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      await pi.eventHandlers["session_start"][0]({}, ctx);

      const mockInstance = MockedLspManager.mock.instances[0];
      mockInstance.getStatus.mockReturnValue([
        { language: "typescript", status: "running", pid: 1234 },
      ]);

      // First tool_result — sets status
      await pi.eventHandlers["tool_result"][0]({}, ctx);

      // Second tool_result — same status, should not update
      await pi.eventHandlers["tool_result"][0]({}, ctx);

      // setStatus for pi-lsp should only have been called once (first time)
      const piLspCalls = ctx.ui.setStatus.mock.calls.filter(
        (c: [string, string | undefined]) => c[0] === "pi-lsp",
      );
      expect(piLspCalls.length).toBe(1);
    });

    it("should skip status update when ctx has no UI", async () => {
      const ctx = {
        cwd: "/test/project",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      await pi.eventHandlers["session_start"][0]({}, ctx);
      await pi.eventHandlers["tool_result"][0]({}, ctx);

      expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    });
  });

  // ── tool_result ────────────────────────────────────────────────────────

  describe("tool_result handler", () => {
    it("should update currentCtx with the new context", async () => {
      const ctx1 = {
        cwd: "/test/project1",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };
      const ctx2 = {
        cwd: "/test/project2",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };

      await pi.eventHandlers["session_start"][0]({}, ctx1);
      await pi.eventHandlers["tool_result"][0]({}, ctx2);

      // After tool_result, subsequent shutdown should use ctx2 (no UI)
      // We can verify by shutting down and checking that ctx2.ui.setStatus is NOT called
      // since ctx2.hasUI is false
      await pi.eventHandlers["session_shutdown"][0]({});
      expect(ctx2.ui.setStatus).not.toHaveBeenCalled();
    });
  });

  // ── lsp-status command ─────────────────────────────────────────────────

  describe("lsp-status command", () => {
    it("should notify when manager is not initialized", async () => {
      const command = pi.commands["lsp-status"];
      expect(command).toBeDefined();

      const ctx = {
        ui: { notify: vi.fn() },
      };

      await command.handler([], ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "LSP manager not initialized. Edit a file first.",
        "info",
      );
    });

    it("should notify when no servers are running", async () => {
      // Start session to initialize manager
      const startCtx = {
        cwd: "/test/project",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };
      await pi.eventHandlers["session_start"][0]({}, startCtx);

      const mockInstance = MockedLspManager.mock.instances[0];
      mockInstance.getStatus.mockReturnValue([]);

      const command = pi.commands["lsp-status"];
      const ctx = { ui: { notify: vi.fn() } };
      await command.handler([], ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith("No LSP servers running.", "info");
    });

    it("should list running servers with their status", async () => {
      const startCtx = {
        cwd: "/test/project",
        hasUI: false,
        ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
      };
      await pi.eventHandlers["session_start"][0]({}, startCtx);

      const mockInstance = MockedLspManager.mock.instances[0];
      mockInstance.getStatus.mockReturnValue([
        { language: "typescript", status: "running", pid: 1234 },
        { language: "python", status: "starting", pid: 5678 },
      ]);

      const command = pi.commands["lsp-status"];
      const ctx = { ui: { notify: vi.fn() } };
      await command.handler([], ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("typescript: running (pid: 1234)"),
        "info",
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("python: starting (pid: 5678)"),
        "info",
      );
    });
  });
});
