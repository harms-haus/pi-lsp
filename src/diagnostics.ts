/**
 * Diagnostics auto-trigger on file edit/write
 * Hooks into the `tool_call` event for `write` and `edit` tools
 * and runs LSP diagnostics after the operation completes
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspManager } from "./lsp-manager.js";
import { languageFromPath } from "./language-config.js";
import { countSeverities } from "./tools/formatting.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function pluralize(count: number, singular: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${singular}s`;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Wait time for diagnostics to arrive from server after batch open (ms) */
const DIAGNOSTICS_WAIT_MS = 1000;

/**
 * Register event handlers to auto-run diagnostics after file edits/writes
 */
export function registerDiagnosticsHook(pi: ExtensionAPI, getManager: () => LspManager | null): void {
  // Track files that have been modified in the current turn
  const modifiedFiles = new Set<string>();

  // Hook into tool_result to catch completed write/edit operations
  pi.on("tool_result", async (event, ctx) => {
    const toolName = event.toolName;

    if (toolName === "write" || toolName === "edit") {
      const filePath = (event.input as { path?: string }).path;

      if (!filePath) return;

      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);
      modifiedFiles.add(resolvedPath);
    }
  });

  // After all tools in a turn complete, run diagnostics on modified files
  pi.on("turn_end", async (event, ctx) => {
    if (modifiedFiles.size === 0) return;

    const manager = getManager();
    if (!manager) return;

    const filesToCheck = Array.from(modifiedFiles);
    modifiedFiles.clear();

    // Filter to files that have a known language config
    const checkableFiles = filesToCheck.filter((filePath) => {
      try {
        return !!languageFromPath(filePath);
      } catch {
        return false;
      }
    });

    if (checkableFiles.length === 0) return;

    // Batch: open all files in parallel first
    await Promise.all(
      checkableFiles.map((filePath) =>
        manager.onFileChanged(filePath).catch(() => {
          /* ignore individual open failures */
        }),
      ),
    );

    // Single wait for all servers to process
    await new Promise((r) => setTimeout(r, DIAGNOSTICS_WAIT_MS));

    // Accumulate totals across all files
    let totalErrors = 0;
    let totalWarnings = 0;
    let filesChecked = 0;

    // Now read diagnostics for each file (fast cache reads)
    for (const filePath of checkableFiles) {
      try {
        const diagnostics = await manager.getDiagnostics(filePath, true);
        const { errors, warnings } = countSeverities(diagnostics);

        totalErrors += errors;
        totalWarnings += warnings;

        filesChecked++;

        if ((errors > 0 || warnings > 0) && ctx.hasUI) {
          const fileName = path.basename(filePath);
          const parts: string[] = [];
          if (errors > 0) parts.push(pluralize(errors, "error"));
          if (warnings > 0) parts.push(pluralize(warnings, "warning"));
          ctx.ui.notify(
            `${fileName}: ${parts.join(", ")}`,
            errors > 0 ? "error" : "warning",
          );
        }
      } catch {
        // Ignore errors from individual file checks
      }
    }

    // Publish aggregated pi-lint status
    if (ctx.hasUI && filesChecked > 0) {
      if (totalErrors > 0 || totalWarnings > 0) {
        const parts: string[] = [];
        if (totalErrors > 0) parts.push(pluralize(totalErrors, "error"));
        if (totalWarnings > 0) parts.push(pluralize(totalWarnings, "warning"));
        ctx.ui.setStatus("pi-lint", parts.join(", "));
      } else {
        ctx.ui.setStatus("pi-lint", "✓ clean");
      }
    }
  });
}


