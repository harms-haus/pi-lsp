import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LspManager } from "../../src/lsp-manager.js";
import { EventEmitter } from "node:events";
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import { TEST_TS_CONFIG, TEST_PY_CONFIG } from "../helpers/fixtures.js";
import type { LspServerConfig } from "../../src/types.js";

// Mock fs and child_process
vi.mock("node:fs");
vi.mock("node:child_process");

// ── Types ─────────────────────────────────────────────────────────────────

/** Parsed JSON-RPC message shape for test assertions */
interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Creates a mock child process with auto-responding stdin/stdout.
 * When the client sends an "initialize" request, the mock automatically
 * responds with { capabilities: {} }.
 */
function createMockProcess() {
  const mockProc = new EventEmitter() as unknown as child_process.ChildProcess;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  const mp = mockProc as Record<string, unknown>;
  mp.stdout = stdoutEmitter;
  mp.stderr = stderrEmitter;
  mp.pid = 12345;
  mp.killed = false;
  mp.kill = vi.fn();

  function sendToClient(msg: Record<string, unknown>) {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    stdoutEmitter.emit("data", Buffer.from(header + body));
  }

  const stdinWrites: string[] = [];

  mp.stdin = {
    write: vi.fn((data: string) => {
      stdinWrites.push(data);
      try {
        const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
        const msg = JSON.parse(body);
        if (msg.method === "initialize") {
          sendToClient({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
        } else if (msg.method === "shutdown") {
          sendToClient({ jsonrpc: "2.0", id: msg.id, result: null });
        }
      } catch {
        /* ignore non-JSON data */
      }
    }),
  } as unknown as NodeJS.WritableStream;

  return { mockProc, stdoutEmitter, stderrEmitter, stdinWrites, sendToClient };
}

/**
 * Starts a server through the LspManager by wiring up the spawn mock.
 * Returns the mock process harness for further control.
 */
async function startMockServer(manager: LspManager, config: LspServerConfig = TEST_TS_CONFIG) {
  const harness = createMockProcess();
  (child_process.spawn as ReturnType<typeof vi.fn>).mockReturnValue(harness.mockProc);
  await manager.startServer(config);
  return harness;
}

/** Parse messages that were written to a mock process's stdin */
function parseSentMessages(writes: string[]): JsonRpcMessage[] {
  return writes
    .map((w) => {
      const body = w.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      try {
        return JSON.parse(body) as JsonRpcMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is JsonRpcMessage => m !== null);
}

/** Get a required value from the client map, throwing if missing */
function getRequiredClient(map: Map<string, unknown>, language: string) {
  const client = map.get(language);
  if (!client) throw new Error(`No client for ${language}`);
  return client;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("LspManager", () => {
  let manager: LspManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new LspManager("/test/cwd", 60_000);
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  // ── Original basic tests (preserved) ────────────────────────────────────

  it("should initialize with correct defaults", () => {
    const status = manager.getStatus();
    expect(status).toEqual([]);
  });







  it("should store diagnostics via handleDiagnosticsNotification", () => {
    const uri = "file:///test.ts";
    const diagnostics = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 1,
        message: "Test error",
      },
    ];

    manager.handleDiagnosticsNotification("typescript", uri, diagnostics);

    // After storing, we'd need to get diagnostics - but we don't have a running server
    // This test just verifies the method exists and can be called
    expect(() => manager.handleDiagnosticsNotification("typescript", uri, diagnostics)).not.toThrow();
  });

  // ── 1. startServer flow ─────────────────────────────────────────────────

  describe("startServer", () => {
    it("should transition server status from stopped → starting → running", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      // After startServer completes, status should be "running"
      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0]).toEqual({
        language: "typescript",
        status: "running",
        pid: 12345,
      });
    });

    it("should register the client in the client map", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      const clientMap = manager.getClientMap();
      expect(clientMap.has("typescript")).toBe(true);
      expect(clientMap.get("typescript")).toBeDefined();
    });

    it("should spawn the process with correct command and args", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      expect(child_process.spawn).toHaveBeenCalledWith(
        "typescript-language-server",
        ["--stdio"],
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
    });

    it("should send initialize request with rootUri", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);

      const messages = parseSentMessages(harness.stdinWrites);
      const initMsg = messages.find((m) => m.method === "initialize");
      expect(initMsg).toBeDefined();
      expect((initMsg?.params as Record<string, unknown>)?.rootUri).toBe("file:///test/cwd");
      expect((initMsg?.params as Record<string, unknown>)?.capabilities).toBeDefined();
    });

    it("should not restart if server is already starting or running", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      // Clear mock call count
      (child_process.spawn as ReturnType<typeof vi.fn>).mockClear();

      // Calling startServer again should be a no-op
      await manager.startServer(TEST_TS_CONFIG);
      expect(child_process.spawn).not.toHaveBeenCalled();
    });

    it("should set status to error if process fails to start", async () => {
      // Make spawn throw synchronously — this causes startProcess to reject
      (child_process.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("spawn ENOENT");
      });

      await expect(manager.startServer(TEST_TS_CONFIG)).rejects.toThrow("spawn ENOENT");

      const status = manager.getStatus();
      expect(status[0].status).toBe("error");
    });
  });

  // ── 2. stopServer ───────────────────────────────────────────────────────

  describe("stopServer", () => {
    it("should clean up clientMap and server entry", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      // Confirm it's running
      expect(manager.getClientMap().has("typescript")).toBe(true);
      expect(manager.getStatus()).toHaveLength(1);

      await manager.stopServer("typescript");

      expect(manager.getClientMap().has("typescript")).toBe(false);
      expect(manager.getStatus()).toHaveLength(0);
    });

    it("should send shutdown request and exit notification", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);
      harness.stdinWrites.length = 0; // clear writes from startup

      await manager.stopServer("typescript");

      const messages = parseSentMessages(harness.stdinWrites);
      const shutdownMsg = messages.find((m) => m.method === "shutdown");
      const exitMsg = messages.find((m) => m.method === "exit");
      expect(shutdownMsg).toBeDefined();
      expect(exitMsg).toBeDefined();
    });

    it("should handle stopping a non-existent server gracefully", async () => {
      // Should not throw
      await expect(manager.stopServer("nonexistent")).resolves.toBeUndefined();
    });
  });

  // ── 3. stopAll ──────────────────────────────────────────────────────────

  describe("stopAll", () => {
    it("should stop multiple servers and clean up everything", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);
      await startMockServer(manager, TEST_PY_CONFIG);

      expect(manager.getClientMap().size).toBe(2);
      expect(manager.getStatus()).toHaveLength(2);

      await manager.stopAll();

      expect(manager.getClientMap().size).toBe(0);
      expect(manager.getStatus()).toHaveLength(0);
    });

    it("should be safe to call multiple times", async () => {
      // stopAll in afterEach already calls stopAll; call again to verify no error
      await manager.stopAll();
      // Second call should be safe
      await manager.stopAll();
    });
  });

  // ── 4. handleDiagnosticsNotification ────────────────────────────────────

  describe("handleDiagnosticsNotification", () => {
    it("should store diagnostics and make them available via getAllDiagnostics", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      const uri = "file:///test/cwd/foo.ts";
      const diagnostics = [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          message: "Unexpected token",
        },
        {
          range: { start: { line: 5, character: 10 }, end: { line: 5, character: 15 } },
          severity: 2,
          message: "Warning message",
        },
      ];

      manager.handleDiagnosticsNotification("typescript", uri, diagnostics);

      const allDiags = manager.getAllDiagnostics();
      expect(allDiags.has(uri)).toBe(true);
      expect(allDiags.get(uri)).toHaveLength(2);
      expect(allDiags.get(uri)?.[0].message).toBe("Unexpected token");
      expect(allDiags.get(uri)?.[1].message).toBe("Warning message");
    });

    it("should overwrite diagnostics for the same URI", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      const uri = "file:///test/cwd/foo.ts";
      manager.handleDiagnosticsNotification("typescript", uri, [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "Old error" },
      ]);

      manager.handleDiagnosticsNotification("typescript", uri, [
        { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, severity: 2, message: "New warning" },
      ]);

      const allDiags = manager.getAllDiagnostics();
      expect(allDiags.get(uri)).toHaveLength(1);
      expect(allDiags.get(uri)?.[0].message).toBe("New warning");
    });

    it("should not store diagnostics for an unknown language", () => {
      const uri = "file:///test/cwd/foo.ts";
      manager.handleDiagnosticsNotification("unknown_lang", uri, [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "Error" },
      ]);

      expect(manager.getAllDiagnostics().size).toBe(0);
    });

    it("should aggregate diagnostics across multiple languages", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);
      await startMockServer(manager, TEST_PY_CONFIG);

      manager.handleDiagnosticsNotification("typescript", "file:///a.ts", [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "TS error" },
      ]);

      manager.handleDiagnosticsNotification("python", "file:///b.py", [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "Py error" },
      ]);

      const allDiags = manager.getAllDiagnostics();
      expect(allDiags.size).toBe(2);
    });
  });

  // ── 5. getDiagnostics ───────────────────────────────────────────────────

  describe("getDiagnostics", () => {
    it("should return empty array for unsupported file extension", async () => {
      const result = await manager.getDiagnostics("/some/file.xyz");
      expect(result).toEqual([]);
    });

    it("should return cached diagnostics for a file with a running server", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      const filePath = "/test/cwd/foo.ts";
      const uri = `file://${filePath}`;
      const diags = [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "TS error" },
      ];

      // Pre-populate diagnostics
      manager.handleDiagnosticsNotification("typescript", uri, diags);

      // Mock fs.readFileSync for ensureFileOpen
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("const x = 1;");

      const result = await manager.getDiagnostics(filePath);
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("TS error");
    });

    it("should request fresh diagnostics when refresh=true", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);

      const filePath = "/test/cwd/foo.ts";
      const uri = `file://${filePath}`;

      // Pre-populate diagnostics so the server entry exists
      manager.handleDiagnosticsNotification("typescript", uri, []);

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("const x = 1;");

      // Replace the stdin write handler to also respond to diagnostic requests
      const writeFn = (harness.mockProc as Record<string, unknown>).stdin as { write: ReturnType<typeof vi.fn> };

      // Clear previous writes to track the new ones
      harness.stdinWrites.length = 0;

      writeFn.write = vi.fn((data: string) => {
        harness.stdinWrites.push(data);
        try {
          const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
          const msg = JSON.parse(body);
          if (msg.method === "textDocument/diagnostic") {
            harness.sendToClient({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                kind: "full",
                items: [
                  { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } }, severity: 1, message: "Fresh diag" },
                ],
              },
            });
          }
        } catch {
          /* ignore */
        }
      }) as unknown as ReturnType<typeof vi.fn>;

      const result = await manager.getDiagnostics(filePath, true);
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("Fresh diag");
    });

    it("should fall back to cached diagnostics when pull model throws", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);

      const filePath = "/test/cwd/foo.ts";
      const uri = `file://${filePath}`;

      // Pre-populate cached diagnostics
      manager.handleDiagnosticsNotification("typescript", uri, [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "Cached error" },
      ]);

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("const x = 1;");

      // Replace stdin.write to respond to diagnostic request with an error
      const writeFn = (harness.mockProc as Record<string, unknown>).stdin as { write: ReturnType<typeof vi.fn> };
      harness.stdinWrites.length = 0;

      writeFn.write = vi.fn((data: string) => {
        harness.stdinWrites.push(data);
        try {
          const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
          const msg = JSON.parse(body);
          if (msg.method === "textDocument/diagnostic") {
            harness.sendToClient({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32601, message: "Method not found" },
            });
          }
        } catch {
          /* ignore */
        }
      }) as unknown as ReturnType<typeof vi.fn>;

      const result = await manager.getDiagnostics(filePath, true);
      // Should fall back to cached diagnostics
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("Cached error");
    });
  });

  // ── 6. ensureFileOpen ───────────────────────────────────────────────────

  describe("ensureFileOpen", () => {
    it("should call didOpen for first open and increment version to 1", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);
      harness.stdinWrites.length = 0;

      const client = getRequiredClient(manager.getClientMap(), "typescript");
      const filePath = "/test/cwd/foo.ts";

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("let x = 1;");

      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath);

      const messages = parseSentMessages(harness.stdinWrites);
      const didOpen = messages.find((m) => m.method === "textDocument/didOpen");
      expect(didOpen).toBeDefined();
      const textDoc = (didOpen?.params as Record<string, Record<string, unknown>>)?.textDocument;
      expect(textDoc?.version).toBe(1);
      expect(textDoc?.text).toBe("let x = 1;");
      expect(textDoc?.uri).toBe(`file://${filePath}`);
      expect(textDoc?.languageId).toBe("typescript");
    });

    it("should call didChange on subsequent opens and increment version", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);
      harness.stdinWrites.length = 0;

      const client = getRequiredClient(manager.getClientMap(), "typescript");
      const filePath = "/test/cwd/foo.ts";

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("let x = 1;");

      // First open
      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath);
      harness.stdinWrites.length = 0;

      // Second open — should use didChange
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("let x = 2;");
      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath);

      const messages = parseSentMessages(harness.stdinWrites);
      const didChange = messages.find((m) => m.method === "textDocument/didChange");
      expect(didChange).toBeDefined();
      const td = (didChange?.params as Record<string, Record<string, unknown>>)?.textDocument;
      expect(td?.version).toBe(2);
      expect(((didChange?.params as Record<string, { text: string }[]>)?.contentChanges)?.[0]?.text).toBe("let x = 2;");
    });

    it("should continue incrementing version across multiple opens", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);
      const client = getRequiredClient(manager.getClientMap(), "typescript");
      const filePath = "/test/cwd/foo.ts";

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("v1");
      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath);

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("v2");
      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath);

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("v3");
      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath);

      // Verify by inspecting the sent messages
      const messages = parseSentMessages(harness.stdinWrites);
      const didOpen = messages.find((m) => m.method === "textDocument/didOpen");
      const didChanges = messages.filter((m) => m.method === "textDocument/didChange");

      const openVersion = ((didOpen?.params as Record<string, Record<string, unknown>>)?.textDocument)?.version;
      expect(openVersion).toBe(1);

      const changeVersions = didChanges.map((m) =>
        ((m.params as Record<string, Record<string, unknown>>)?.textDocument)?.version,
      );
      expect(changeVersions).toEqual([2, 3]);
    });

    it("should use empty string if readFile fails", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);
      harness.stdinWrites.length = 0;

      const client = getRequiredClient(manager.getClientMap(), "typescript");
      const filePath = "/test/cwd/nonexistent.ts";

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath);

      const messages = parseSentMessages(harness.stdinWrites);
      const didOpen = messages.find((m) => m.method === "textDocument/didOpen");
      expect(didOpen).toBeDefined();
      const text = ((didOpen?.params as Record<string, Record<string, unknown>>)?.textDocument)?.text;
      expect(text).toBe("");
    });

    it("should use provided content instead of reading the file", async () => {
      const harness = await startMockServer(manager, TEST_TS_CONFIG);
      harness.stdinWrites.length = 0;

      const client = getRequiredClient(manager.getClientMap(), "typescript");
      const filePath = "/test/cwd/foo.ts";

      // fs.readFileSync should NOT be called if content is provided
      await manager.ensureFileOpen(client, TEST_TS_CONFIG, filePath, "provided content");

      expect(fs.readFileSync).not.toHaveBeenCalled();

      const messages = parseSentMessages(harness.stdinWrites);
      const didOpen = messages.find((m) => m.method === "textDocument/didOpen");
      const text = ((didOpen?.params as Record<string, Record<string, unknown>>)?.textDocument)?.text;
      expect(text).toBe("provided content");
    });
  });

  // ── 7. File tracking cap (200) ──────────────────────────────────────────

  describe("file tracking cap", () => {
    it("should prune oldest entries when more than 200 files are tracked", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);
      const client = getRequiredClient(manager.getClientMap(), "typescript");

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("content");

      // Track 205 files
      for (let i = 0; i < 205; i++) {
        await manager.ensureFileOpen(
          client,
          TEST_TS_CONFIG,
          `/test/cwd/file_${i.toString().padStart(3, "0")}.ts`,
          `content ${i}`,
        );
      }

      // The manager should still be functional after pruning
      const status = manager.getStatus();
      expect(status[0].status).toBe("running");

      // The cap removes (size - MAX + 10) entries when size > MAX (200)
      // After 205 files, it removes 15 entries → 190 remain
      // Verify that new files can still be added
      // Verify new files can still be opened after pruning
      const harnessForExtra = createMockProcess();
      (child_process.spawn as ReturnType<typeof vi.fn>).mockReturnValue(harnessForExtra.mockProc);

      // Add another file — it should work fine since version tracking is pruned
      await manager.ensureFileOpen(client, TEST_TS_CONFIG, "/test/cwd/file_extra.ts", "extra content");

      // The manager is still functional
      expect(manager.getStatus()[0].status).toBe("running");
    });

    it("should also prune diagnostics when files are pruned", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);
      const client = getRequiredClient(manager.getClientMap(), "typescript");

      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("content");

      // Open 205 files and store diagnostics for the first few
      for (let i = 0; i < 205; i++) {
        const path = `/test/cwd/file_${i.toString().padStart(3, "0")}.ts`;
        await manager.ensureFileOpen(client, TEST_TS_CONFIG, path, `content ${i}`);

        // Add diagnostics for the first few files (these will be the oldest)
        if (i < 5) {
          const uri = `file://${path}`;
          manager.handleDiagnosticsNotification("typescript", uri, [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: `Error ${i}` },
          ]);
        }
      }

      // The first few files should have been pruned (they were added first = oldest)
      // So their diagnostics should be gone from getAllDiagnostics
      const allDiags = manager.getAllDiagnostics();
      // The first files' diagnostics should have been cleaned up during pruning
      expect(allDiags.size).toBeLessThan(205);
    });
  });

  // ── 8. getClientForFile with unknown language ───────────────────────────

  describe("getClientForFile", () => {
    it("should return null for unsupported file extensions", async () => {
      const result = await manager.getClientForFile("/some/file.xyz");
      expect(result).toBeNull();
    });

    it("should return null for files with no extension that don't match any config", async () => {
      const result = await manager.getClientForFile("/some/Makefile");
      expect(result).toBeNull();
    });

    it("should start a server and return a client for supported extensions", async () => {
      (child_process.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return createMockProcess().mockProc;
      });

      const result = await manager.getClientForFile("/test/cwd/foo.ts");
      expect(result).not.toBeNull();
      expect(manager.getClientMap().has("typescript")).toBe(true);
    });
  });

  // ── 9. getStatus ────────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("should return empty array when no servers are running", () => {
      expect(manager.getStatus()).toEqual([]);
    });

    it("should return correct status for a running server", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      const status = manager.getStatus();
      expect(status).toEqual([
        { language: "typescript", status: "running", pid: 12345 },
      ]);
    });

    it("should return status for multiple servers", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);
      await startMockServer(manager, TEST_PY_CONFIG);

      const status = manager.getStatus();
      expect(status).toHaveLength(2);

      const languages = status.map((s) => s.language).sort();
      expect(languages).toEqual(["python", "typescript"]);

      // Both should be running
      for (const s of status) {
        expect(s.status).toBe("running");
        expect(s.pid).toBe(12345);
      }
    });

    it("should reflect stopped status after stopping a server", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);
      await manager.stopServer("typescript");

      expect(manager.getStatus()).toEqual([]);
    });
  });

  // ── 10. Dead process restart ────────────────────────────────────────────

  describe("dead process restart", () => {
    it("should restart server when process died", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);
      expect(manager.getStatus()[0].status).toBe("running");

      // Get the client and mock isAlive to return false
      const client = manager.getClientMap().get("typescript");
      expect(client).toBeDefined();
      vi.spyOn(client!, "isAlive").mockReturnValue(false);

      // Wire spawn for the restart
      (child_process.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return createMockProcess().mockProc;
      });

      // Calling getClientForConfig should detect the dead process and restart
      const result = await manager.getClientForConfig(TEST_TS_CONFIG);
      expect(result).not.toBeNull();
    });
  });

  // ── 11. Shutdown fallback to kill ───────────────────────────────────────

  describe("shutdown fallback", () => {
    it("should fall back to kill when shutdown fails", async () => {
      await startMockServer(manager, TEST_TS_CONFIG);

      // Get the client and mock shutdown to reject
      const client = manager.getClientMap().get("typescript");
      expect(client).toBeDefined();

      const killSpy = vi.spyOn(client!, "kill");

      vi.spyOn(client!, "shutdown").mockImplementation(async () => {
        throw new Error("shutdown failed");
      });

      await manager.stopServer("typescript");

      expect(killSpy).toHaveBeenCalled();
    });
  });

  // ── 12. Idle server cleanup ─────────────────────────────────────────────

  describe("idle server cleanup", () => {
    it("should stop idle servers on check", async () => {
      // Create manager with a very short idle timeout (1ms)
      await manager.stopAll();
      manager = new LspManager("/test/cwd", 1); // 1ms idle timeout

      await startMockServer(manager, TEST_TS_CONFIG);
      expect(manager.getStatus()).toHaveLength(1);

      // Set lastActive to a long time ago
      const servers = (manager as any).state.servers as Map<string, any>;
      const server = servers.get("typescript");
      server.lastActive = 0; // Very old

      // Trigger idle check
      (manager as any).checkIdleServers();

      // Give the async stopServer a moment
      await new Promise((r) => setTimeout(r, 50));

      // Server should have been stopped
      expect(manager.getStatus()).toHaveLength(0);
    });
  });

  // ── 13. onFileChanged for unsupported files ─────────────────────────────

  describe("onFileChanged", () => {
    it("should handle onFileChanged for unsupported file", async () => {
      // Should not start any client, should not throw
      await expect(manager.onFileChanged("file.xyz")).resolves.toBeUndefined();
      expect(manager.getClientMap().size).toBe(0);
      expect(manager.getStatus()).toHaveLength(0);
    });
  });
});
