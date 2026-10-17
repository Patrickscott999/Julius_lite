import Anthropic from "@anthropic-ai/sdk";
import type { ModelProvider, ProviderMessage, ProviderTools, TurnRequest, TurnResult } from "./types";

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;
  private model: string;
  private titleModel: string;

  constructor(opts?: { client?: Anthropic; model?: string; titleModel?: string }) {
    this.client = opts?.client ?? new Anthropic();
    this.model = opts?.model ?? process.env.JULIUS_MODEL ?? process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "claude-opus-5-5";
    this.titleModel = opts?.titleModel ?? process.env.JULIUS_TITLE_MODEL ?? process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-5-5";
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: req.system,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        strict: true,
      })),
      messages: this.toApiMessages(req.messages),
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        req.onTextDelta(event.delta.text);
      }
    }
    const message = await stream.finalMessage();
    const blocks: TurnResult["blocks"] = [];
    for (const block of message.content) {
      if (block.type === "text") blocks.push({ type: "text", text: block.text });
      else if (block.type === "tool_use") blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    }
    return { blocks, stopReason: message.stop_reason === "tool_use" ? "tool_use" : "end_turn" };
  }

  async generateTitle(userMessage: string): Promise<string> {
    try {
      const title = await this.client.messages.create({
        model: this.titleModel,
        max_tokens: 500, // reasoning models spend tokens on hidden thinking blocks first
        messages: [{ role: "user", content: `Give a 2-5 word title for a data analysis task starting with: "${userMessage.slice(0, 200)}". Reply with ONLY the title, no quotes.` }],
      });
      return title.content.find((b) => b.type === "text")?.text?.trim() ?? "";
    } catch {
      return "";
    }
  }

  /** Provider-neutral history → Anthropic MessageParam[]. */
  toApiMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      switch (m.role) {
        case "user":
          if (m.text.trim()) out.push({ role: "user", content: m.text });
          break;
        case "assistant": {
          const content: Anthropic.ContentBlockParam[] = m.blocks.map((b) =>
            b.type === "text" ? { type: "text", text: b.text } : { type: "tool_use", id: b.id, name: b.name, input: b.input as Record<string, unknown> },
          );
          if (content.length) out.push({ role: "assistant", content });
          break;
        }
        case "tool_results": {
          const results: Anthropic.ToolResultBlockParam[] = m.results.map((r) => ({
            type: "tool_result",
            tool_use_id: r.toolUseId,
            is_error: r.isError || undefined,
            content: [{ type: "text", text: r.content }],
          }));
          if (results.length) out.push({ role: "user", content: results });
          break;
        }
        case "system":
          break; // mid-conversation operator notes are folded into user turns upstream
      }
    }
    return out;
  }
}