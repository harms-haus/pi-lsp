import { describe, it, expect, vi, beforeEach } from "vitest";
import { LspClient } from "../../src/lsp-client.js";
import { createTestServerInstance } from "../helpers/fixtures.js";

describe("LspClient JSON-RPC parsing", () => {
  let server: ReturnType<typeof createTestServerInstance>;
  let onNotification: ReturnType<typeof vi.fn>;
  let client: LspClient;

  beforeEach(() => {
    server = createTestServerInstance();
    onNotification = vi.fn();
    client = new LspClient(server, onNotification);
  });

  it("should parse a complete Content-Length message", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///test.ts", diagnostics: [] },
    });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    // Access private handleData via any
    (client as any).handleData(message);

    expect(onNotification).toHaveBeenCalledWith(
      "textDocument/publishDiagnostics",
      { uri: "file:///test.ts", diagnostics: [] },
    );
  });

  it("should handle partial messages across multiple data events", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "test", params: {} });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    // Split the message in half
    const mid = Math.floor(message.length / 2);
    (client as any).handleData(message.slice(0, mid));
    expect(onNotification).not.toHaveBeenCalled();

    (client as any).handleData(message.slice(mid));
    expect(onNotification).toHaveBeenCalledWith("test", {});
  });

  it("should handle partial header", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "test", params: {} });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    // Send only part of the header
    (client as any).handleData("Content-Length: ");
    expect(onNotification).not.toHaveBeenCalled();

    // Send the rest
    (client as any).handleData(msg.slice("Content-Length: ".length));
    expect(onNotification).toHaveBeenCalledWith("test", {});
  });

  it("should parse multiple messages in one data chunk", () => {
    const body1 = JSON.stringify({ jsonrpc: "2.0", method: "method1", params: {} });
    const body2 = JSON.stringify({ jsonrpc: "2.0", method: "method2", params: {} });
    const msg1 = `Content-Length: ${Buffer.byteLength(body1)}\r\n\r\n${body1}`;
    const msg2 = `Content-Length: ${Buffer.byteLength(body2)}\r\n\r\n${body2}`;

    (client as any).handleData(msg1 + msg2);

    expect(onNotification).toHaveBeenCalledTimes(2);
    expect(onNotification).toHaveBeenNthCalledWith(1, "method1", {});
    expect(onNotification).toHaveBeenNthCalledWith(2, "method2", {});
  });

  // Skip request/response tests as they require a proper mock process
  it.skip("should handle response message and resolve pending request", async () => {
    // Requires full process mock integration
  });

  it.skip("should handle error response and reject pending request", async () => {
    // Requires full process mock integration
  });

  it.skip("should send request message with correct format", () => {
    // Requires proper process mock
  });

  it.skip("should send notification without id", () => {
    // Requires proper process mock
  });

  it.skip("should timeout pending requests", async () => {
    // Requires proper process mock
  });

  it("should handle notification with no callback registered", () => {
    const client2 = new LspClient(server); // No onNotification callback
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "randomNotification",
      params: {},
    });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    // Should not throw
    expect(() => {
      (client2 as any).handleData(message);
    }).not.toThrow();
  });

  it("should ignore messages without proper Content-Length header", () => {
    const message = "Invalid message without header\r\n\r\n";

    expect(() => {
      (client as any).handleData(message);
    }).not.toThrow();

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("should buffer partial body content", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "test", params: {} });
    const message = `Content-Length: ${body.length}\r\n\r\n`;

    // Send header first
    (client as any).handleData(message);
    expect(onNotification).not.toHaveBeenCalled();

    // Send partial body
    (client as any).handleData(body.slice(0, 10));
    expect(onNotification).not.toHaveBeenCalled();

    // Send rest of body
    (client as any).handleData(body.slice(10));
    expect(onNotification).toHaveBeenCalledWith("test", {});
  });
});
