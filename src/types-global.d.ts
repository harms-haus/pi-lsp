/**
 * Type declarations for external runtime dependencies
 * These are provided by the pi framework at runtime
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- External pi Extension API uses any types */

declare module "typebox" {
  export const Type: {
    String(options?: { description?: string }): any;
    Number(options?: { description?: string }): any;
    Boolean(options?: { description?: string }): any;
    Optional<T>(t: T): any;
    Object<T extends Record<string, any>>(properties: T): any;
  };
}

declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    registerTool(config: {
      name: string;
      label: string;
      description: string;
      promptSnippet: string;
      promptGuidelines: string[];
      parameters: any;
      execute: (
        toolCallId: any,
        params: any,
        signal: any,
        onUpdate: any,
        ctx: any,
      ) => Promise<any>;
    }): void;
    registerCommand(name: string, config: {
      description: string;
      handler: (args: any, ctx: any) => Promise<void>;
    }): void;
    on(event: string, handler: (event: any, ctx: any) => Promise<void> | void): void;
  }
}
