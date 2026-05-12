/**
 * LSP Manager - Server lifecycle management
 * Handles starting, stopping, idle timeout, and auto-install of LSP servers
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { LspServerConfig, LspServerInstance, LspManagerState } from "./types.js";
import { LspClient } from "./lsp-client.js";
import { languageFromPath } from "./language-config.js";

const FIVE_MINUTES = 60_000; // Check every minute
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class LspManager {
  private state: LspManagerState;
  private clientMap: Map<string, LspClient> = new Map();
  private shutdownHandler: (() => Promise<void>) | null = null;

  constructor(cwd: string, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
    this.state = {
      servers: new Map(),
      idleTimeoutMs,
      idleCheckInterval: null,
      cwd,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      extensionMap: new Map(), // Built lazily
    };

    // Start idle checker
    this.state.idleCheckInterval = setInterval(() => this.checkIdleServers(), FIVE_MINUTES);
  }

  /** Get the LSP client for a language, starting the server if needed */
  async getClientForFile(filePath: string): Promise<LspClient | null> {
    const config = languageFromPath(filePath);
    if (!config) return null;
    return this.getClientForConfig(config);
  }

  /** Get the LSP client for a specific language config */
  async getClientForConfig(config: LspServerConfig): Promise<LspClient | null> {
    let server = this.state.servers.get(config.language);

    // If server exists but process died, clean up
    if (server && server.status !== "stopped") {
      const client = this.clientMap.get(config.language);
      if (client && !client.isAlive()) {
        this.stopServer(config.language);
        server = undefined;
      }
    }

    if (!server || server.status === "stopped" || server.status === "error") {
      await this.startServer(config);
      server = this.state.servers.get(config.language);
    }

    if (!server || server.status !== "running") {
      return null;
    }

    return this.clientMap.get(config.language) || null;
  }

  /** Start an LSP server for the given config */
  async startServer(config: LspServerConfig): Promise<void> {
    const existing = this.state.servers.get(config.language);
    if (existing && (existing.status === "starting" || existing.status === "running")) {
      return;
    }

    // Clean up any stopped instance
    if (existing) {
      this.stopServer(config.language);
    }

    const server: LspServerInstance = {
      config,
      status: "starting",
      pid: null,
      nextId: 1,
      pendingRequests: new Map(),
      lastActive: Date.now(),
      fileVersions: new Map(),
      diagnostics: new Map(),
      rootUri: null,
      initialized: false,
      initPromise: null,
      capabilities: null,
    };

    this.state.servers.set(config.language, server);

    const client = new LspClient(server, (method, params) => this.handleNotification(config.language, method, params));
    this.clientMap.set(config.language, client);

    // Determine root URI
    const rootUri = pathToFileURL(this.state.cwd).href;
    server.rootUri = rootUri;

    try {
      // Start the process
      await client.startProcess(config);

      // Initialize
      await client.initialize(config, rootUri);

      server.lastActive = Date.now();
    } catch (err) {
      server.status = "error";
      server.initPromise = null;
      throw err;
    }
  }

  /** Stop an LSP server gracefully */
  async stopServer(language: string): Promise<void> {
    const client = this.clientMap.get(language);
    if (client) {
      try {
        await client.shutdown();
      } catch {
        client.kill();
      }
      this.clientMap.delete(language);
    }
    this.state.servers.delete(language);
  }

  /** Stop all LSP servers */
  async stopAll(): Promise<void> {
    const languages = Array.from(this.clientMap.keys());
    await Promise.all(languages.map((lang) => this.stopServer(lang)));
    if (this.state.idleCheckInterval) {
      clearInterval(this.state.idleCheckInterval);
      this.state.idleCheckInterval = null;
    }
  }

  /** Check for idle servers and stop them */
  private checkIdleServers(): void {
    const now = Date.now();
    for (const [language, server] of this.state.servers) {
      if (server.status === "running" && now - server.lastActive > this.state.idleTimeoutMs) {
        this.stopServer(language).catch(() => {
          // Ignore errors during idle cleanup
        });
      }
    }
  }

  /** Mark a server as active (reset idle timer) */
  touchServer(language: string): void {
    const server = this.state.servers.get(language);
    if (server) {
      server.lastActive = Date.now();
    }
  }

  /** Get diagnostics for a file */
  async getDiagnostics(filePath: string, refresh = false): Promise<import("vscode-languageserver-types").Diagnostic[]> {
    const config = languageFromPath(filePath);
    if (!config) return [];

    const client = await this.getClientForFile(filePath);
    if (!client) return [];

    const uri = pathToFileURL(filePath).href;
    const server = this.state.servers.get(config.language);
    if (!server) return [];

    // Ensure the file is open
    await this.ensureFileOpen(client, config, filePath);

    // For push-model servers, return cached diagnostics
    // For pull-model servers (LSP 3.17+), request diagnostics
    if (refresh || server.diagnostics.get(uri)?.length === undefined || !server.diagnostics.has(uri)) {
      try {
        // Try pull model first
        const result = await client.requestDiagnostics(uri);
        if (result && typeof result === "object" && "kind" in result && result.kind === "full") {
          const diags = (result as any).items || [];
          server.diagnostics.set(uri, diags);
          return diags;
        }
      } catch {
        // Pull model not supported; use cached diagnostics from notifications
      }
    }

    return server.diagnostics.get(uri) || [];
  }

  /** Handle a notification from the LSP server */
  private handleNotification(language: string, method: string, params: unknown): void {
    if (method === "textDocument/publishDiagnostics") {
      const diagParams = params as { uri: string; diagnostics: import("vscode-languageserver-types").Diagnostic[] };
      if (diagParams?.uri) {
        this.handleDiagnosticsNotification(language, diagParams.uri, diagParams.diagnostics || []);
      }
    }
  }

  /** Handle a diagnostics notification from the server */
  handleDiagnosticsNotification(language: string, uri: string, diagnostics: import("vscode-languageserver-types").Diagnostic[]): void {
    const server = this.state.servers.get(language);
    if (server) {
      server.diagnostics.set(uri, diagnostics);
      server.lastActive = Date.now();
    }
  }

  /** Ensure a file is open in the LSP server */
  async ensureFileOpen(
    client: LspClient,
    config: LspServerConfig,
    filePath: string,
    content?: string,
  ): Promise<void> {
    const uri = pathToFileURL(filePath).href;
    const server = this.state.servers.get(config.language);
    if (!server) return;

    // Read file content if not provided
    let text = content;
    if (text === undefined) {
      try {
        text = fs.readFileSync(filePath, "utf-8");
      } catch {
        text = "";
      }
    }

    const currentVersion = server.fileVersions.get(uri) ?? 0;
    const newVersion = currentVersion + 1;

    if (currentVersion === 0) {
      // First open
      const langId = config.language === "cpp" ? "cpp" : config.language;
      await client.didOpen(uri, langId, newVersion, text);
    } else {
      client.didChange(uri, newVersion, text);
    }

    server.fileVersions.set(uri, newVersion);
    server.lastActive = Date.now();
  }

  /** Handle a file being written/edited — open it and trigger diagnostics */
  async onFileChanged(filePath: string): Promise<void> {
    const config = languageFromPath(filePath);
    if (!config) return;

    const client = await this.getClientForConfig(config);
    if (!client) return;

    await this.ensureFileOpen(client, config, filePath);
    // Diagnostics will arrive via notification (push model)
    // or can be fetched via pull model
  }

  /** Get server status summary */
  getStatus(): { language: string; status: string; pid: number | null }[] {
    const result: { language: string; status: string; pid: number | null }[] = [];
    for (const [lang, server] of this.state.servers) {
      result.push({ language: lang, status: server.status, pid: server.pid });
    }
    return result;
  }

  /** Get the manager state */
  getState(): LspManagerState {
    return this.state;
  }

  /** Get the client map (for direct access by tools) */
  getClientMap(): Map<string, LspClient> {
    return this.clientMap;
  }

  /** Register a shutdown handler */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandler = handler;
  }
}
