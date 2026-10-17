import { describe, it, expect, vi } from "vitest";
import { TOOLS, type StreamEvent } from "../agent-core";
import { runAgent, toProviderMessages, printed, type DatasetRec, type AgentContext } from "../agent-run";
import type { MessageBlock } from "../db";
import { OpenAIProvider } from "../providers/openai";
import { AnthropicProvider } from "../providers/anthropic";
import type { ModelProvider, ProviderMessage, ProviderTurnBlock, TurnResult } from "../providers/types";

const NO_DATASETS: DatasetRec[] = [];

describe("TOOLS schema", () => {
  it("declares strict schemas with required fields", () => {
    for (const tool of TOOLS) {
      expect(tool.strict).toBe(true);
      const schema = tool.input_schema as { required: string[] };
      expect(schema.required.length).toBeGreaterThan(0);
    }
  });
});

describe("toProviderMessages replay", () => {
  it("rebuilds tool_use/tool_result pairs from persisted blocks", () => {
    const history = [
      { role: "user" as const, blocks: [{ type: "text", text: "…data…" } as MessageBlock] },
      {
        role: "assistant" as const,
        blocks: [
          { type: "run", code: "print(df.head())", stdout: "ok" } as MessageBlock,
          { type: "chart", kind: "bar", title: "T", labels: ["a"], series: [{ name: "x", values: [1] }] } as MessageBlock,
        ],
      },
      { role: "user" as const, blocks: [{ type: "text", text: "and now?" } as MessageBlock] },
    ];
    const msgs = toProviderMessages(history);
    expect(msgs).toHaveLength(4);
    if (msgs[1].role !== "assistant") throw new Error("expected assistant turn");
    expect(msgs[1].blocks[0]).toMatchObject({ type: "tool_use", name: "run_python" });
    expect(msgs[2].role).toBe("tool_results");
    expect(msgs[3].role).toBe("user");
  });
});

describe("printed() grounding", () => {
  it("matches int and float forms", () => {
    expect(printed("Revenues: [100, 150]", 150)).toBe(true);
    expect(printed("avg is 150.0 total", 150)).toBe(true);
    expect(printed("avg: 149.9", 150)).toBe(false);
  });
});

/** Turn list consumed in order; a fake ModelProvider. */
function fakeProvider(turns: (Omit<TurnResult, "stopReason"> & { stopReason?: TurnResult["stopReason"] })[], title = "My Task Title"): ModelProvider {
  let i = 0;
  return {
    name: "openai",
    runTurn: async (req) => {
      const turn = turns[Math.min(i++, turns.length - 1)];
      for (const b of turn.blocks) {
        if (b.type === "text") req.onTextDelta(b.text);
      }
      return { blocks: turn.blocks, stopReason: turn.stopReason ?? (turn.blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") };
    },
    generateTitle: async () => title,
  };
}

describe("runAgent", () => {
  it("streams text, runs python, feeds back real stdout, and finishes", async () => {
    const events: StreamEvent[] = [];
    const runPython = vi.fn(async () => ({ stdout: "Revenue: 150\n" }));
    const provider = fakeProvider([
      {
        blocks: [
          { type: "text", text: "Let me check." } as ProviderTurnBlock,
          { type: "tool_use", id: "tu1", name: "run_python", input: { code: "print(df)" } } as ProviderTurnBlock,
        ],
      },
      { blocks: [{ type: "text", text: "The revenue is 150." } as ProviderTurnBlock], stopReason: "end_turn" },
    ]);

    const history: AgentContext["history"] = [];
    let title = "";
    await runAgent({
      datasets: NO_DATASETS,
      history,
      emit: (e) => events.push(e),
      runPython,
      provider,
      onTitle: (t) => (title = t),
      isFirstTurn: true,
      userMessage: "Analyze my sales data",
    });

    expect(title).toBe("My Task Title");
    expect(runPython).toHaveBeenCalledWith("print(df)", []);
    expect(events.map((e) => e.type)).toEqual(["text", "tool_start", "tool_result", "text", "done"]);
    // the persisted run block must replay back as REAL stdout (grounded next turns)
    const replay = toProviderMessages(history);
    expect(replay.some((m) => m.role === "tool_results" && m.results[0].content === "Revenue: 150\n")).toBe(true);
    expect(history.filter((t) => t.role === "assistant")).toHaveLength(2); // one entry per model turn
  });

  it("rejects chart values not grounded in printed output", async () => {
    const events: StreamEvent[] = [];
    const runPython = vi.fn(async () => ({ stdout: "Revenues: [100, 150]\n" }));
    const provider = fakeProvider([
      {
        blocks: [
          { type: "tool_use", id: "r1", name: "run_python", input: { code: "print('Revenues: [100, 150]')" } } as ProviderTurnBlock,
          { type: "tool_use", id: "g1", name: "render_chart", input: { kind: "bar", title: "G", labels: ["a"], series: [{ name: "x", values: [100, 150] }] } } as ProviderTurnBlock,
          { type: "tool_use", id: "b1", name: "render_chart", input: { kind: "bar", title: "B", labels: ["a"], series: [{ name: "x", values: [100, 999] }] } } as ProviderTurnBlock,
        ],
      },
      { blocks: [{ type: "text", text: "done" } as ProviderTurnBlock], stopReason: "end_turn" },
    ]);
    await runAgent({
      datasets: NO_DATASETS,
      history: [],
      emit: (e) => events.push(e),
      runPython,
      provider,
    });
    const charts = events.filter((e) => e.type === "chart");
    expect(charts).toHaveLength(1);
  });
});

describe("OpenAI adapter", () => {
  const provider = new OpenAIProvider({ client: {} as never });

  it("maps neutral history to OpenAI messages", () => {
    const neutral: ProviderMessage[] = [
      { role: "user", text: "hi" },
      { role: "assistant", blocks: [{ type: "tool_use", id: "c1", name: "run_python", input: { code: "x=1" } }] },
      { role: "tool_results", results: [{ toolUseId: "c1", content: "ok", isError: false }] },
      { role: "assistant", blocks: [{ type: "text", text: "answer" }] },
    ];
    const msgs = provider.toOpenAiMessages(neutral, "SYSTEM");
    expect(msgs[0]).toMatchObject({ role: "system", content: "SYSTEM" });
    expect(msgs[1]).toMatchObject({ role: "user", content: "hi" });
    expect(msgs[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", type: "function" }] });
    expect(msgs[3]).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(msgs[4]).toMatchObject({ role: "assistant", content: "answer" });
  });

  it("maps tools to function definitions", () => {
    const { tools } = provider.toOpenAiTools([{ name: "run_python", description: "run code", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } }]);
    expect(tools[0].type).toBe("function");
    if (!("function" in tools[0])) throw new Error("expected function tool");
    expect(tools[0].function.name).toBe("run_python");
  });
});

describe("Anthropic adapter", () => {
  const provider = new AnthropicProvider({ client: {} as never });

  it("maps neutral history to Anthropic MessageParam[]", () => {
    const neutral: ProviderMessage[] = [
      { role: "user", text: "hi" },
      { role: "assistant", blocks: [{ type: "tool_use", id: "c1", name: "run_python", input: { code: "x=1" } }] },
      { role: "tool_results", results: [{ toolUseId: "c1", content: "ok", isError: false }] },
    ];
    const msgs = provider.toApiMessages(neutral);
    expect(msgs[0]).toMatchObject({ role: "user" });
    expect(msgs[1]).toMatchObject({ role: "assistant", content: [{ type: "tool_use", id: "c1" }] });
    expect(msgs[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "c1" }] });
  });
});