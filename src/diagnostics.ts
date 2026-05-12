/**
 * Diagnostics auto-trigger on file edit/write
 * Hooks into the `tool_call` event for `write` and `edit` tools
 * and runs LSP diagnostics after the operation completes
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "./lsp-manager.js";
import { languageFromPath } from "./language-config.js";

// ── Constants ─────────────────────────────────────────────────────────────

/** Delay before triggering diagnostics after file change (ms) */
const DIAGNOSTICS_SETTLE_DELAY_MS = 500;
/** Wait time for diagnostics to arrive from server (ms) */
const DIAGNOSTICS_WAIT_MS = 1000;

/**
 * Register event handlers to auto-run diagnostics after file edits/writes
 */
export function registerDiagnosticsHook(pi: ExtensionAPI, manager: LspManager): void {
  // Track files that have been modified in the current turn
  const modifiedFiles = new Set<string>();

  // Hook into tool_result to catch completed write/edit operations
  pi.on("tool_result", async (event, ctx) => {
    const toolName = event.toolName;

    if (toolName === "write" || toolName === "edit") {
      let filePath: string | undefined;

      if (toolName === "write") {
        filePath = (event.input as { path?: string }).path;
      } else if (toolName === "edit") {
        filePath = (event.input as { path?: string }).path;
      }

      if (!filePath) return;

      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);
      modifiedFiles.add(resolvedPath);
    }
  });

  // After all tools in a turn complete, run diagnostics on modified files
  pi.on("turn_end", async (event, ctx) => {
    if (modifiedFiles.size === 0) return;

    const filesToCheck = Array.from(modifiedFiles);
    modifiedFiles.clear();

    // Small delay to let LSP server process the changes
    await new Promise((r) => setTimeout(r, DIAGNOSTICS_SETTLE_DELAY_MS));

    // Run diagnostics for each modified file
    for (const filePath of filesToCheck) {
      try {
        const config = languageFromPath(filePath);
        if (!config) continue;

        // Trigger the file change in LSP (open + didChange)
        await manager.onFileChanged(filePath);

        // Wait briefly for diagnostics to arrive, then check
        await new Promise((r) => setTimeout(r, DIAGNOSTICS_WAIT_MS));

        const diagnostics = await manager.getDiagnostics(filePath, true);
        if (diagnostics.length > 0 && ctx.hasUI) {
          const errors = diagnostics.filter((d) => d.severity === 1).length;
          const warnings = diagnostics.filter((d) => d.severity === 2).length;
          const fileName = path.basename(filePath);
          if (errors > 0 || warnings > 0) {
            ctx.ui.notify(
              `${fileName}: ${errors} error(s), ${warnings} warning(s)`,
              errors > 0 ? "error" : "warning",
            );
          }
        }
      } catch {
        // Ignore errors from individual file checks
      }
    }
  });
}


