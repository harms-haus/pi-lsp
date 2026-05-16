/**
 * Preamble logic shared across LSP tool handlers
 */

import type { LspManager } from "../lsp-manager.js";
import type { LspClient } from "../lsp-client-methods.js";
import type { LspServerConfig } from "../types.js";
import {
  LANGUAGE_SERVERS,
  languageFromPath,
  isServerInstalled,
} from "../language-config.js";
import { resolveFile, filePathToUri } from "./paths.js";

// ── UI Interface (for typing the `ui` parameter) ──────────────────────────

interface ToolUI {
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level: "info" | "warning" | "error" | "success"): void;
}

// ── Server Install ─────────────────────────────────────────────────────────

/** Ensure an LSP server is installed, prompting the user if needed */
export async function ensureServerInstalled(
  language: string,
  ui: ToolUI,
): Promise<boolean> {
  const config = LANGUAGE_SERVERS.find((c) => c.language === language);
  if (!config) return false;

  const installed = await isServerInstalled(config);
  if (installed) return true;

  const ok = await ui.confirm(
    `Install LSP server: ${language}`,
    `The ${language} language server is not installed.\n\nInstall command: ${config.installCommand}\n\nWould you like to install it now?`,
  );
  if (!ok) return false;

  ui.notify(`Installing ${language} LSP server...`, "info");

  const { execFile } = await import("node:child_process");
  const installParts = config.installCommand.split(/\s+/);
  const installCmd = installParts[0];
  const installArgs = installParts.slice(1);
  const result = await new Promise<{ success: boolean; output: string }>((resolve) => {
    execFile(installCmd, installArgs, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = stdout + stderr;
      resolve({ success: !error, output });
    });
  });

  if (!result.success) {
    ui.notify(`Failed to install ${language} LSP server. Check the install command: ${config.installCommand}`, "error");
    return false;
  }

  ui.notify(`${language} LSP server installed successfully.`, "success");

  // Verify installation
  const verified = await isServerInstalled(config);
  if (!verified) {
    ui.notify(`Installation verification failed for ${language}. You may need to restart pi.`, "warning");
    return false;
  }

  return true;
}

// ── Tool Preamble (shared across file-based tools) ─────────────────────────

/** Result of the common tool preamble */
export interface PreambleResult {
  filePath: string;
  config: LspServerConfig;
  client: LspClient;
  uri: string;
  manager: LspManager;
}

/**
 * Execute the shared preamble that all file-based LSP tools need:
 * 1. Resolve file path
 * 2. Detect language
 * 3. Ensure server is installed
 * 4. Get or start LSP client
 * 5. Ensure file is open in the server
 * 6. Convert to URI
 *
 * Returns the preamble result or an error response object.
 */
export async function executePreamble(
  file: string,
  cwd: string,
  getManager: () => LspManager | null,
  ui: ToolUI,
): Promise<{ ok: PreambleResult } | { error: { content: { type: string; text: string }[]; details: Record<string, unknown>; isError: boolean } }> {
  const manager = getManager();
  if (!manager) {
    return {
      error: {
        content: [{ type: "text", text: "LSP manager not initialized. Start a session first." }],
        details: {},
        isError: true,
      },
    };
  }

  const filePath = resolveFile(file, cwd);
  const config = languageFromPath(filePath);

  if (!config) {
    return {
      error: {
        content: [{ type: "text", text: `No LSP server configured for "${file}".\n\nSupported languages: ${LANGUAGE_SERVERS.map((c) => c.language).join(", ")}` }],
        details: { file },
        isError: true,
      },
    };
  }

  const installed = await isServerInstalled(config);
  if (!installed) {
    const available = await ensureServerInstalled(config.language, ui);
    if (!available) {
      return {
        error: {
          content: [{ type: "text", text: `LSP server for ${config.language} is not installed.\n\nInstall: ${config.installCommand}` }],
          details: { file },
          isError: true,
        },
      };
    }
  }

  const client = await manager.getClientForConfig(config);
  if (!client) {
    return {
      error: {
        content: [{ type: "text", text: `Failed to start LSP server for ${config.language}.` }],
        details: { file },
        isError: true,
      },
    };
  }

  const uri = filePathToUri(filePath);
  await manager.ensureFileOpen(client, config, filePath);

  return { ok: { filePath, config, client, uri, manager } };
}
