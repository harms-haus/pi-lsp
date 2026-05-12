import { vi } from "vitest";

/**
 * Create a mock ExtensionAPI for testing tool registrations.
 * Captures all registered tools so their execute functions can be called directly.
 */
export function createMockExtensionApi() {
  const tools: Array<{
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: Function;
  }> = [];

  const commands: Array<{
    name: string;
    handler: Function;
  }> = {};

  const eventHandlers: Record<string, Function[]> = {};

  const pi = {
    registerTool: vi.fn((tool: unknown) => {
      tools.push(tool as any);
    }),
    registerCommand: vi.fn((name: string, command: unknown) => {
      commands[name] = command as any;
    }),
    on: vi.fn((event: string, handler: Function) => {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
    }),
    tools,
    commands,
    eventHandlers,
  };

  return pi;
}

/** Find a registered tool by name */
export function getTool(pi: ReturnType<typeof createMockExtensionApi>, name: string) {
  return pi.tools.find((t) => t.name === name);
}
