/**
 * pi-lsp: LSP Integration Extension for pi
 *
 * Features:
 * - Auto-diagnostics on file edit/write
 * - Auto-install LSP servers on first use
 * - 11 LSP tools: diagnostics, find_references, rename_symbol, find_definition, find_symbols,
 *                  find_calls, find_document_symbols, hover, find_implementations,
 *                  find_type_definition, find_type_hierarchy
 * - Persistent LSP servers with 5-min idle timeout
 * - 33 language LSP support
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LspManager } from "./lsp-manager.js";
import { registerDiagnosticsHook } from "./diagnostics.js";
import { registerDiagnosticsTool } from "./tools/diagnostics.js";
import { registerFindReferencesTool } from "./tools/find_references.js";
import { registerFindDefinitionTool } from "./tools/find_definition.js";
import { registerFindSymbolsTool } from "./tools/find_symbols.js";
import { registerFindCallsTool } from "./tools/find_calls.js";
import { registerRenameSymbolTool } from "./tools/rename_symbol.js";
import { registerFindDocumentSymbolsTool } from "./tools/find_document_symbols.js";
import { registerHoverTool } from "./tools/hover.js";
import { registerFindImplementationsTool } from "./tools/find_implementations.js";
import { registerFindTypeDefinitionTool } from "./tools/find_type_definition.js";
import { registerFindTypeHierarchyTool } from "./tools/find_type_hierarchy.js";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export default function (pi: ExtensionAPI) {
  let manager: LspManager | null = null;
  let cwd = process.cwd();
  let currentCtx: any;
  let lastLspStatus: string | undefined;

  function getManager(): LspManager | null {
    return manager;
  }

  function getCwd(): string {
    return cwd;
  }

  function initManager(): void {
    if (manager) return;
    manager = new LspManager(cwd, IDLE_TIMEOUT_MS);
  }

  // ── Session Lifecycle ──────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    currentCtx = ctx;
    initManager();
    if (ctx.hasUI) {
      ctx.ui.notify("pi-lsp extension loaded", "info");
    }
    publishLspStatus();
  });

  pi.on("session_shutdown", async () => {
    if (manager) {
      await manager.stopAll();
      manager = null;
    }
    if (currentCtx?.hasUI) {
      currentCtx.ui.setStatus("pi-lsp", undefined);
      currentCtx.ui.setStatus("pi-lint", undefined);
    }
    currentCtx = undefined;
    lastLspStatus = undefined;

  });

  // ── Register Tools ─────────────────────────────────────────────────────

  registerDiagnosticsHook(pi, getManager);

  registerDiagnosticsTool(pi, getManager, getCwd);
  registerFindReferencesTool(pi, getManager, getCwd);
  registerFindDefinitionTool(pi, getManager, getCwd);
  registerFindSymbolsTool(pi, getManager, getCwd);
  registerFindCallsTool(pi, getManager, getCwd);
  registerRenameSymbolTool(pi, getManager, getCwd);
  registerFindDocumentSymbolsTool(pi, getManager, getCwd);
  registerHoverTool(pi, getManager, getCwd);
  registerFindImplementationsTool(pi, getManager, getCwd);
  registerFindTypeDefinitionTool(pi, getManager, getCwd);
  registerFindTypeHierarchyTool(pi, getManager, getCwd);

  // ── Status Publishing ───────────────────────────────────────────────────

  function publishLspStatus(): void {
    if (!currentCtx?.hasUI) return;
    if (!manager) {
      if (lastLspStatus !== undefined) {
        currentCtx.ui.setStatus("pi-lsp", undefined);
        lastLspStatus = undefined;
      }
      return;
    }
    const runningLanguages = manager.getStatus()
        .filter((s: { status: string }) => s.status === "running")
        .map((s: { language: string }) => s.language);
    const newStatus = runningLanguages.length > 0
        ? runningLanguages.join(", ")
        : undefined;
    if (newStatus !== lastLspStatus) {
      lastLspStatus = newStatus;
      currentCtx.ui.setStatus("pi-lsp", newStatus);
    }
  }

  pi.on("tool_result", async (_event, ctx) => {
    currentCtx = ctx;
    publishLspStatus();
  });

  // ── Register Commands ──────────────────────────────────────────────────

  pi.registerCommand("lsp-status", {
    description: "Show status of all LSP servers",
    handler: async (_args, ctx) => {
      if (!manager) {
        ctx.ui.notify("LSP manager not initialized. Edit a file first.", "info");
        return;
      }

      const status = manager.getStatus();
      if (status.length === 0) {
        ctx.ui.notify("No LSP servers running.", "info");
        return;
      }

      const lines = status.map((s) => `${s.language}: ${s.status} (pid: ${s.pid})`);
      ctx.ui.notify(`LSP Servers:\n${lines.join("\n")}`, "info");
    },
  });
}
