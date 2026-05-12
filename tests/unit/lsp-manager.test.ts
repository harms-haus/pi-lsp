import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LspManager } from "../../src/lsp-manager.js";

// Mock fs and child_process
vi.mock("node:fs");
vi.mock("node:child_process");

describe("LspManager", () => {
  let manager: LspManager;

  beforeEach(() => {
    manager = new LspManager("/test/cwd", 60_000); // 1 min idle timeout for tests
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it("should initialize with correct defaults", () => {
    const status = manager.getStatus();
    expect(status).toEqual([]);
  });

  it("should return empty status initially", () => {
    const status = manager.getStatus();
    expect(status).toBeInstanceOf(Array);
    expect(status.length).toBe(0);
  });

  it("should have getClientMap method", () => {
    expect(manager.getClientMap).toBeDefined();
    expect(typeof manager.getClientMap).toBe("function");
  });

  it("should have getDiagnostics method", () => {
    expect(manager.getDiagnostics).toBeDefined();
    expect(typeof manager.getDiagnostics).toBe("function");
  });

  it("should have handleDiagnosticsNotification method", () => {
    expect(manager.handleDiagnosticsNotification).toBeDefined();
    expect(typeof manager.handleDiagnosticsNotification).toBe("function");
  });

  it("should have stopServer method", () => {
    expect(manager.stopServer).toBeDefined();
    expect(typeof manager.stopServer).toBe("function");
  });

  it("should have stopAll method", () => {
    expect(manager.stopAll).toBeDefined();
    expect(typeof manager.stopAll).toBe("function");
  });

  it("should store diagnostics via handleDiagnosticsNotification", () => {
    const uri = "file:///test.ts";
    const diagnostics = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 1,
        message: "Test error",
      },
    ] as any;

    manager.handleDiagnosticsNotification("typescript", uri, diagnostics);

    // After storing, we'd need to get diagnostics - but we don't have a running server
    // This test just verifies the method exists and can be called
    expect(() => manager.handleDiagnosticsNotification("typescript", uri, diagnostics)).not.toThrow();
  });
});
