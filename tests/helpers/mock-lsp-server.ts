import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { ChildProcess } from "node:child_process";

/**
 * Creates a mock LSP server process that responds to JSON-RPC messages.
 */
export function createMockLspServer() {
  const mockProcess = new EventEmitter() as unknown as ChildProcess;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const stdinWrites: string[] = [];

  mockProcess.stdout = stdoutEmitter as unknown as NodeJS.ReadableStream;
  mockProcess.stderr = stderrEmitter as unknown as NodeJS.ReadableStream;
  mockProcess.stdin = {
    write: vi.fn((data: string) => {
      stdinWrites.push(data);
      try {
        const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
        const msg = JSON.parse(body);
        // Auto-respond to initialize
        if (msg.method === "initialize") {
          respond(msg.id, { capabilities: {} });
        }
      } catch { /* ignore */ }
    }),
  } as unknown as NodeJS.WritableStream;
  mockProcess.pid = 12345;
  mockProcess.killed = false;
  mockProcess.kill = vi.fn();

  function respond(id: number, result: unknown) {
    const body = JSON.stringify({ jsonrpc: "2.0", id, result });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    stdoutEmitter.emit("data", Buffer.from(message));
  }

  function respondError(id: number, code: number, message: string) {
    const body = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    stdoutEmitter.emit("data", Buffer.from(msg));
  }

  function sendNotification(method: string, params: unknown) {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    stdoutEmitter.emit("data", Buffer.from(message));
  }

  function getSentMessages() {
    return stdinWrites.map((w) => {
      const body = w.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      try { return JSON.parse(body); } catch { return null; }
    }).filter(Boolean);
  }

  return { mockProcess, respond, respondError, sendNotification, getSentMessages, stdoutEmitter, stderrEmitter };
}
