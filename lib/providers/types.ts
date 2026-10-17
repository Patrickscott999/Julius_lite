/**
 * Provider-neutral turn protocol. The agent loop (agent-run.ts) speaks only
 * this shape; adapters translate to Anthropic / OpenAI wire formats.
 */

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type ProviderTurnBlock = { type: "text"; text: string } | ToolUseBlock;

export type ToolResultPayload = {
  toolUseId: string;
  content: string;
  isError: boolean;
};

/** Internal history items, provider-neutral. */
export type ProviderMessage =
  | { role: "system"; text: string }
  | { role: "user"; text: string }
  | { role: "assistant"; blocks: ProviderTurnBlock[] }
  | { role: "tool_results"; results: ToolResultPayload[] };

export interface ProviderTools {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface TurnRequest {
  system: string;
  messages: ProviderMessage[];
  tools: ProviderTools[];
  onTextDelta: (text: string) => void;
}

export interface TurnResult {
  blocks: ProviderTurnBlock[];
  stopReason: "end_turn" | "tool_use";
}

export interface ModelProvider {
  readonly name: "anthropic" | "openai";
  runTurn(req: TurnRequest): Promise<TurnResult>;
  /** Small-model task title; best-effort, providers may return "". */
  generateTitle(userMessage: string): Promise<string>;
}