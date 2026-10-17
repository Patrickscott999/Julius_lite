import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { ModelProvider, ProviderMessage, ProviderTools, TurnRequest, TurnResult } from "./types";

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai" as const;
  private client: OpenAI;
  private model: string;
  private titleModel: string;

  constructor(opts?: { client?: OpenAI; model?: string; titleModel?: string }) {
    this.client = opts?.client ?? new OpenAI(); // resolves OPENAI_API_KEY (and OPENAI_BASE_URL)
    this.model = opts?.model ?? process.env.JULIUS_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5";
    this.titleModel = opts?.titleModel ?? process.env.JULIUS_TITLE_MODEL ?? process.env.OPENAI_TITLE_MODEL ?? "gpt-5";
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: 64000,
      stream: true,
      stream_options: { include_usage: true },
      tools: this.toOpenAiTools(req.tools).tools,
      messages: this.toOpenAiMessages(req.messages, req.system),
    });

    let text = "";
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        req.onTextDelta(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const entry = toolCalls.get(tc.index) ?? { id: tc.id ?? "", name: "", args: "" };
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name += entry.name ? "" : tc.function.name;
        if (tc.function?.arguments) entry.args += tc.function.arguments;
        toolCalls.set(tc.index, entry);
      }
    }

    const blocks: TurnResult["blocks"] = [];
    if (text) blocks.push({ type: "text", text });
    for (const [, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      blocks.push({ type: "tool_use", id: tc.id || `call_${toolCalls.size}`, name: tc.name, input: safeJsonParse(tc.args) });
    }
    const finish = toolCalls.size > 0 ? "tool_use" : "end_turn";
    return { blocks, stopReason: finish };
  }

  async generateTitle(userMessage: string): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.titleModel,
        max_completion_tokens: 2000,
        // reasoning models eat the token budget on hidden thinking; low effort
        // keeps the title cheap AND leaves room for visible text
        reasoning_effort: "low",
        messages: [{ role: "user", content: `Give a 2-5 word title for a data analysis task starting with: "${userMessage.slice(0, 200)}". Reply with ONLY the title, no quotes.` }],
      });
      return (res.choices[0]?.message?.content ?? "").trim();
    } catch {
      return "";
    }
  }

  /** Our neutral tools → OpenAI function definitions. */
  toOpenAiTools(tools: ProviderTools[]): { tools: ChatCompletionTool[] } {
    return {
      tools: tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
          strict: true,
        },
      })),
    };
  }

  /** Our neutral history → OpenAI ChatCompletionMessageParam[]. */
  toOpenAiMessages(messages: ProviderMessage[], system: string): ChatCompletionMessageParam[] {
    const out: ChatCompletionMessageParam[] = [{ role: "system" as const, content: system }];
    for (const m of messages) {
      switch (m.role) {
        case "user":
          if (m.text.trim()) out.push({ role: "user" as const, content: m.text });
          break;
        case "assistant": {
          const text = m.blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
          const calls = m.blocks.filter((b) => b.type === "tool_use");
          if (calls.length > 0) {
            out.push({
              role: "assistant" as const,
              content: text || null,
              tool_calls: calls.map((b) => ({
                id: b.id,
                type: "function" as const,
                function: { name: b.name, arguments: JSON.stringify(b.input) },
              })),
            });
          } else if (text) {
            out.push({ role: "assistant" as const, content: text });
          }
          break;
        }
        case "tool_results":
          for (const r of m.results) {
            out.push({ role: "tool" as const, tool_call_id: r.toolUseId, content: r.content });
          }
          // An assistant tool_calls turn MUST be followed by tool messages;
          // if none consumed, skip quietly (shouldn't happen in our flow).
          break;
        case "system":
          out.push({ role: "system" as const, content: m.text });
          break;
      }
    }
    return out;
  }
}

export function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s === "" ? {} : s; // tolerable fallback; grounding guard catches malformed chains
  }
}

export type { ProviderTools };