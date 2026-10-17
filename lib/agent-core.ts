import type { MessageBlock } from "./db";

/**
 * Wire protocol for the chat SSE stream (JSONL, one object per line).
 * These are the events the client renderer understands.
 */
export type StreamEvent =
  | { type: "title"; taskTitle: string; taskId: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: "run_python"; code: string }
  | {
      type: "tool_result";
      tool: "run_python";
      stdout: string;
      error?: string;
    }
  | { type: "chart"; chart: Extract<MessageBlock, { type: "chart" }> }
  | { type: "done" }
  | { type: "error"; message: string };

/** Tool schemas sent to the model. Kept beside the protocol for one source of truth. */
export const TOOLS = [
  {
    name: "run_python",
    strict: true,
    description:
      "Run Python on the pandas DataFrame(s) pre-loaded in the sandbox. " +
      "Datasets are already defined as pandas DataFrames. print() results; " +
      "the final expression's value is also shown. Use up to ~60 lines per call.",
    input_schema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "Python using pandas (df variables already defined)." },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "render_chart",
    strict: true,
    description:
      "Render an interactive chart for the user. Call after you have extracted the values to plot.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["bar", "line", "pie"] },
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        series: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              values: { type: "array", items: { type: "number" } },
            },
            required: ["name", "values"],
            additionalProperties: false,
          },
        },
      },
      required: ["kind", "title", "labels", "series"],
      additionalProperties: false,
    },
  },
];

/** Cap the stdout captured from one python run (bytes). */
export const MAX_STDOUT = 20000;

/**
 * Convert an Anthropic Message content array into persisted MessageBlocks.
 * Tool calls become rendered blocks the client understands.
 */
export function messageToBlocks(content: AnthropicContent[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) blocks.push({ type: "text", text: buffer });
    buffer = "";
  };
  for (const block of content) {
    if (block.type === "text") buffer += block.text;
    else if (block.type === "run" || block.type === "chart") blocks.push(block);
  }
  flush();
  return blocks;
}

/** Narrow Anthropic content to our persisted shape (input types are ours). */
type AnthropicContent = Extract<MessageBlock, { type: "text" }> | Extract<MessageBlock, { type: "run" }> | Extract<MessageBlock, { type: "chart" }>;