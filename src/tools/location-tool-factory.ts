import { Type } from "typebox";
import { executePreamble } from "./preamble.js";
import { toolError, sanitizeError } from "./formatting.js";
import { flattenLocations, formatLocations } from "./paths.js";

const Schema = Type.Object({
  file: Type.String({ description: "Path to the file" }),
  line: Type.Number({ description: "Line number (1-indexed)" }),
  column: Type.Number({ description: "Column number (1-indexed)" }),
});

interface LocationToolConfig {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  resultLabel: string;
  resultKey: string;
  locationSuffix: boolean;
  method: (client: any, uri: string, line: number, col: number) => Promise<any>;
}

export function registerLocationTool(
  pi: any,
  getManager: () => any,
  getCwd: () => string,
  config: LocationToolConfig,
): void {
  pi.registerTool({
    name: config.name,
    label: config.label,
    description: config.description,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    parameters: Schema,
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const preamble = await executePreamble(params.file, getCwd(), getManager, ctx.ui);
      if ("error" in preamble) return preamble.error;

      const { client, uri } = preamble.ok;

      try {
        const result = await config.method(client, uri, params.line - 1, params.column - 1);
        const locations = flattenLocations(result);
        const formatted = formatLocations(locations);
        const mapped = locations.map((l) => ({ uri: l.uri, line: l.range.start.line + 1, col: l.range.start.character + 1 }));

        const suffix = config.locationSuffix ? " location(s)" : "";
        return {
          content: [{ type: "text", text: `${config.resultLabel}: ${mapped.length}${suffix}\n\n${formatted}` }],
          details: { file: params.file, line: params.line, column: params.column, [config.resultKey]: mapped, count: mapped.length },
          isError: false,
        };
      } catch (err) {
        return toolError(sanitizeError(err, `Failed to ${config.name.replace(/_/g, " ")}`), { file: params.file, line: params.line, column: params.column });
      }
    },
  });
}
