/**
 * pi-lsp: LSP Integration Extension for pi
 *
 * Features:
 * - Auto-diagnostics on file edit/write
 * - Auto-install LSP servers on first use
 * - 6 LSP tools: diagnostics, find-references, refactor-symbol,
 *                 goto-definition, find-symbol, call-hierarchy
 * - Persistent LSP servers with 5-min idle timeout
 * - 33 language LSP support
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LspManager } from "./lsp-manager.js";
import { registerDiagnosticsHook } from "./diagnostics.js";
import { registerDiagnosticsTool } from "./tools/diagnostics.js";
import { registerFindReferencesTool } from "./tools/find-references.js";
import { registerRefactorSymbolTool } from "./tools/refactor-symbol.js";
import { registerGotoDefinitionTool } from "./tools/goto-definition.js";
import { registerFindSymbolTool } from "./tools/find-symbol.js";
import { registerCallHierarchyTool } from "./tools/call-hierarchy.js";

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
    registerDiagnosticsHook(pi, manager);
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
    }
    currentCtx = undefined;
    lastLspStatus = undefined;
  });

  // ── Register Tools ─────────────────────────────────────────────────────

  registerDiagnosticsTool(pi, getManager, getCwd);
  registerFindReferencesTool(pi, getManager, getCwd);
  registerRefactorSymbolTool(pi, getManager, getCwd);
  registerGotoDefinitionTool(pi, getManager, getCwd);
  registerFindSymbolTool(pi, getManager, getCwd);
  registerCallHierarchyTool(pi, getManager, getCwd);

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
