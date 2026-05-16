import { describe, it, expect, beforeEach } from "vitest";
import { createClientWithMock } from "../helpers/create-client-with-mock.js";
import type { MockClientHarness } from "../helpers/create-client-with-mock.js";
import type { JsonRpcRequest, JsonRpcNotification } from "../../src/lsp-protocol.js";

type SentMessage = JsonRpcRequest | JsonRpcNotification;

describe("LspClient Methods", () => {
  let h: MockClientHarness;

  beforeEach(() => {
    h = createClientWithMock();
  });

  /**
   * Helper: start the process and initialize so the client is in "running" state.
   */
  async function startAndInitialize(rootUri: string | null = "file:///tmp") {
    h.autoRespond();
    await h.client.startProcess(h.config);
    await h.client.initialize(h.config, rootUri);
  }

  /**
   * Helper: intercept the last sent JSON-RPC request message, respond to it,
   * and return the intercepted message for assertions.
   */
  function interceptAndRespond(method: string, result: unknown): SentMessage & { id: number } {
    const msgs = h.getSentMessages() as SentMessage[];
    const req = msgs.find((m) => m.method === method) as (SentMessage & { id: number }) | undefined;
    if (!req) {
      const methods = msgs.map((m) => m.method);
      throw new Error(`No message with method "${method}" was sent. Messages: ${JSON.stringify(methods)}`);
    }
    h.sendToClient({ jsonrpc: "2.0", id: req.id, result });
    return req;
  }

  /**
   * Helper: find a sent message by method name.
   */
  function findSentMessage(method: string): SentMessage | undefined {
    return (h.getSentMessages() as SentMessage[]).find((m) => m.method === method);
  }

  // ─── Request-based methods ─────────────────────────────────────────────

  describe("Request-based methods", () => {
    beforeEach(async () => {
      await startAndInitialize();
    });

    it("initialize should send initialize request and initialized notification, then set status to running", async () => {
      // Already called via startAndInitialize — verify the effects
      const msgs = h.getSentMessages() as SentMessage[];
      const initReq = msgs.find((m) => m.method === "initialize");
      expect(initReq).toBeDefined();
      expect(initReq?.params).toMatchObject({
        processId: expect.any(Number),
        rootUri: "file:///tmp",
        capabilities: {
          textDocument: {
            synchronization: { didSave: false },
            completion: { completionItem: { snippetSupport: false } },
            diagnostic: { dynamicRegistration: false },
          },
          workspace: {
            workspaceFolders: false,
            symbol: { dynamicRegistration: false },
          },
          window: { workDoneProgress: false },
        },
      });

      const initNotif = msgs.find((m) => m.method === "initialized");
      expect(initNotif).toBeDefined();
      expect(initNotif?.params).toEqual({});

      expect(h.server.status).toBe("running");
    });

    it("gotoDefinition should send textDocument/definition with correct position", async () => {
      const promise = h.client.gotoDefinition("file:///test.ts", 10, 25);
      const req = interceptAndRespond("textDocument/definition", [
        { uri: "file:///test.ts", range: { start: { line: 10, character: 25 }, end: { line: 10, character: 30 } } },
      ]);
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 10, character: 25 },
      });
      const result = await promise;
      expect(result).toEqual([
        { uri: "file:///test.ts", range: { start: { line: 10, character: 25 }, end: { line: 10, character: 30 } } },
      ]);
    });

    it("findReferences should send textDocument/references with includeDeclaration true", async () => {
      const promise = h.client.findReferences("file:///test.ts", 5, 3);
      const req = interceptAndRespond("textDocument/references", [
        { uri: "file:///test.ts", range: { start: { line: 5, character: 3 }, end: { line: 5, character: 8 } } },
      ]);
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 5, character: 3 },
        context: { includeDeclaration: true },
      });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("prepareRename should send textDocument/prepareRename with correct position", async () => {
      const promise = h.client.prepareRename("file:///test.ts", 1, 7);
      const req = interceptAndRespond("textDocument/prepareRename", {
        range: { start: { line: 1, character: 7 }, end: { line: 1, character: 12 } },
        placeholder: "myVar",
      });
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 1, character: 7 },
      });
      const result = await promise;
      expect(result).toEqual({
        range: { start: { line: 1, character: 7 }, end: { line: 1, character: 12 } },
        placeholder: "myVar",
      });
    });

    it("rename should send textDocument/rename with newName param", async () => {
      const promise = h.client.rename("file:///test.ts", 2, 4, "newName");
      const req = interceptAndRespond("textDocument/rename", {
        changes: { "file:///test.ts": [] },
      });
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 2, character: 4 },
        newName: "newName",
      });
      const result = await promise;
      expect(result).toBeDefined();
    });

    it("workspaceSymbol should send workspace/symbol with query", async () => {
      const promise = h.client.workspaceSymbol("MyClass");
      const req = interceptAndRespond("workspace/symbol", [
        { name: "MyClass", kind: 5, location: { uri: "file:///test.ts", range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } } } },
      ]);
      expect(req.params).toEqual({ query: "MyClass" });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("prepareCallHierarchy should send textDocument/prepareCallHierarchy", async () => {
      const promise = h.client.prepareCallHierarchy("file:///test.ts", 8, 2);
      const req = interceptAndRespond("textDocument/prepareCallHierarchy", [
        { name: "myFunc", kind: 12, uri: "file:///test.ts", range: { start: { line: 8, character: 0 }, end: { line: 15, character: 1 } }, selectionRange: { start: { line: 8, character: 2 }, end: { line: 8, character: 8 } } },
      ]);
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 8, character: 2 },
      });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("incomingCalls should send callHierarchy/incomingCalls with item param", async () => {
      const item = {
        name: "myFunc",
        kind: 12,
        uri: "file:///test.ts",
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      };
      const promise = h.client.incomingCalls(item);
      const req = interceptAndRespond("callHierarchy/incomingCalls", [
        { from: item, fromRanges: [{ start: { line: 5, character: 0 }, end: { line: 5, character: 10 } }] },
      ]);
      expect(req.params).toEqual({ item });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("outgoingCalls should send callHierarchy/outgoingCalls with item param", async () => {
      const item = {
        name: "myFunc",
        kind: 12,
        uri: "file:///test.ts",
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      };
      const promise = h.client.outgoingCalls(item);
      const req = interceptAndRespond("callHierarchy/outgoingCalls", [
        { to: item, fromRanges: [{ start: { line: 2, character: 0 }, end: { line: 2, character: 10 } }] },
      ]);
      expect(req.params).toEqual({ item });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("documentSymbol should send textDocument/documentSymbol with textDocument.uri", async () => {
      const promise = h.client.documentSymbol("file:///test.ts");
      const req = interceptAndRespond("textDocument/documentSymbol", [
        { name: "MyClass", kind: 5, range: { start: { line: 0, character: 0 }, end: { line: 20, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } } },
      ]);
      expect(req.params).toEqual({ textDocument: { uri: "file:///test.ts" } });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("hover should send textDocument/hover", async () => {
      const promise = h.client.hover("file:///test.ts", 3, 10);
      const req = interceptAndRespond("textDocument/hover", {
        contents: { kind: "markdown", value: "test hover" },
        range: { start: { line: 3, character: 10 }, end: { line: 3, character: 15 } },
      });
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 3, character: 10 },
      });
      const result = await promise;
      expect(result).toBeDefined();
    });

    it("findImplementations should send textDocument/implementation", async () => {
      const promise = h.client.findImplementations("file:///test.ts", 7, 4);
      const req = interceptAndRespond("textDocument/implementation", [
        { uri: "file:///impl.ts", range: { start: { line: 1, character: 0 }, end: { line: 5, character: 1 } } },
      ]);
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 7, character: 4 },
      });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("findTypeDefinition should send textDocument/typeDefinition", async () => {
      const promise = h.client.findTypeDefinition("file:///test.ts", 2, 8);
      const req = interceptAndRespond("textDocument/typeDefinition", [
        { uri: "file:///types.ts", range: { start: { line: 10, character: 0 }, end: { line: 20, character: 1 } } },
      ]);
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 2, character: 8 },
      });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("prepareTypeHierarchy should send textDocument/prepareTypeHierarchy", async () => {
      const promise = h.client.prepareTypeHierarchy("file:///test.ts", 4, 6);
      const req = interceptAndRespond("textDocument/prepareTypeHierarchy", [
        { name: "MyClass", kind: 5, uri: "file:///test.ts", range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } } },
      ]);
      expect(req.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
        position: { line: 4, character: 6 },
      });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("typeHierarchySupertypes should send typeHierarchy/supertypes with item", async () => {
      const item = {
        name: "MyClass",
        kind: 5,
        uri: "file:///test.ts",
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
      };
      const promise = h.client.typeHierarchySupertypes(item, 2);
      const req = interceptAndRespond("typeHierarchy/supertypes", [
        { name: "BaseClass", kind: 5, uri: "file:///base.ts", range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } } },
      ]);
      expect(req.params).toEqual({ item, resolve: 2 });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("typeHierarchySupertypes should not include resolve when undefined", async () => {
      const item = {
        name: "MyClass",
        kind: 5,
        uri: "file:///test.ts",
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
      };
      const promise = h.client.typeHierarchySupertypes(item);
      const req = interceptAndRespond("typeHierarchy/supertypes", []);
      expect(req.params).toEqual({ item });
      const result = await promise;
      expect(result).toEqual([]);
    });

    it("typeHierarchySubtypes should send typeHierarchy/subtypes with item", async () => {
      const item = {
        name: "MyClass",
        kind: 5,
        uri: "file:///test.ts",
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
      };
      const promise = h.client.typeHierarchySubtypes(item, 3);
      const req = interceptAndRespond("typeHierarchy/subtypes", [
        { name: "ChildClass", kind: 5, uri: "file:///child.ts", range: { start: { line: 0, character: 0 }, end: { line: 8, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
      ]);
      expect(req.params).toEqual({ item, resolve: 3 });
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it("typeHierarchySubtypes should not include resolve when undefined", async () => {
      const item = {
        name: "MyClass",
        kind: 5,
        uri: "file:///test.ts",
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
      };
      const promise = h.client.typeHierarchySubtypes(item);
      const req = interceptAndRespond("typeHierarchy/subtypes", []);
      expect(req.params).toEqual({ item });
      const result = await promise;
      expect(result).toEqual([]);
    });

    it("requestDiagnostics should send textDocument/diagnostic with textDocument.uri", async () => {
      const promise = h.client.requestDiagnostics("file:///test.ts");
      const req = interceptAndRespond("textDocument/diagnostic", {
        kind: "full",
        items: [],
      });
      expect(req.params).toEqual({ textDocument: { uri: "file:///test.ts" } });
      const result = await promise;
      expect(result).toBeDefined();
    });
  });

  // ─── Notification-based methods ────────────────────────────────────────

  describe("Notification-based methods", () => {
    beforeEach(async () => {
      await startAndInitialize();
    });

    it("didOpen should send textDocument/didOpen notification", async () => {
      await h.client.didOpen("file:///test.ts", "typescript", 1, "const x = 1;");
      const notif = findSentMessage("textDocument/didOpen") as JsonRpcNotification;
      expect(notif).toBeDefined();
      expect("id" in notif).toBe(false);
      expect(notif.params).toEqual({
        textDocument: {
          uri: "file:///test.ts",
          languageId: "typescript",
          version: 1,
          text: "const x = 1;",
        },
      });
    });

    it("didChange should send textDocument/didChange notification", () => {
      h.client.didChange("file:///test.ts", 2, "const y = 2;");
      const notif = findSentMessage("textDocument/didChange") as JsonRpcNotification;
      expect(notif).toBeDefined();
      expect("id" in notif).toBe(false);
      expect(notif.params).toEqual({
        textDocument: { uri: "file:///test.ts", version: 2 },
        contentChanges: [{ text: "const y = 2;" }],
      });
    });

    it("didClose should send textDocument/didClose notification", () => {
      h.client.didClose("file:///test.ts");
      const notif = findSentMessage("textDocument/didClose") as JsonRpcNotification;
      expect(notif).toBeDefined();
      expect("id" in notif).toBe(false);
      expect(notif.params).toEqual({
        textDocument: { uri: "file:///test.ts" },
      });
    });
  });

  // ─── Lifecycle methods ─────────────────────────────────────────────────

  describe("Lifecycle methods", () => {
    it("shutdown should send shutdown request and exit notification, then set status to stopped", async () => {
      await startAndInitialize();
      expect(h.server.status).toBe("running");

      await h.client.shutdown();

      const msgs = h.getSentMessages() as SentMessage[];
      const shutdownReq = msgs.find((m) => m.method === "shutdown") as SentMessage & { id: number };
      expect(shutdownReq).toBeDefined();
      expect(shutdownReq.id).toBeDefined();

      const exitNotif = msgs.find((m) => m.method === "exit") as JsonRpcNotification;
      expect(exitNotif).toBeDefined();
      expect("id" in (exitNotif as object)).toBe(false);
      expect(exitNotif.params).toEqual({});

      expect(h.server.status).toBe("stopped");
      expect((h.client as unknown as { process: unknown }).process).toBeNull();
      expect(h.server.pid).toBeNull();
    });

    it("shutdown should not send anything if status is not running", async () => {
      // Server status starts as "stopped" since we don't start+initialize
      const msgsBefore = h.getSentMessages().length;
      await h.client.shutdown();
      const msgsAfter = h.getSentMessages().length;
      expect(msgsAfter).toBe(msgsBefore);
    });

    it("kill should send SIGKILL to process and set status to stopped", async () => {
      await startAndInitialize();
      expect(h.server.status).toBe("running");

      h.client.kill();

      expect(h.mockProcess.kill).toHaveBeenCalledWith("SIGKILL");
      expect(h.server.status).toBe("stopped");
      expect((h.client as unknown as { process: unknown }).process).toBeNull();
      expect(h.server.pid).toBeNull();
    });

    it("kill should be a no-op if process is null", () => {
      expect((h.client as unknown as { process: unknown }).process).toBeNull();
      expect(() => h.client.kill()).not.toThrow();
      expect(h.server.status).toBe("stopped");
    });

    it("isAlive should return true when process is running", async () => {
      await startAndInitialize();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (h.mockProcess as any).killed = false;
      expect(h.client.isAlive()).toBe(true);
    });

    it("isAlive should return false when process is null", () => {
      expect(h.client.isAlive()).toBe(false);
    });

    it("isAlive should return false when process has been killed", async () => {
      await startAndInitialize();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (h.mockProcess as any).killed = true;
      expect(h.client.isAlive()).toBe(false);
    });
  });
});
