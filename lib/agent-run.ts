import { runPython } from "./pyodide-sandbox";
import { TOOLS, type StreamEvent } from "./agent-core";
import type { ModelProvider, ProviderMessage, ProviderTools } from "./providers/types";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";
import type { MessageBlock } from "./db";

export interface DatasetRec {
  name: string;
  varName: string;
  path: string;
  columns: string[];
  preview: { header: string[]; rows: string[][]; rowCount: number };
}

const MODEL: "anthropic" | "openai" = resolveProvider();
const MAX_TURNS = 10;
function resolveProvider(): "anthropic" | "openai" {
  if (process.env.JULIUS_PROVIDER) {
    const p = process.env.JULIUS_PROVIDER.toLowerCase();
    if (p === "openai" || p === "anthropic") return p;
  }
  return process.env.OPENAI_API_KEY ? "openai" : "anthropic";
}

const PROVIDER_TOOLS: ProviderTools[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

export interface AgentContext {
  datasets: DatasetRec[];
  history: { role: "user" | "assistant"; blocks: MessageBlock[] }[];
  emit: (event: StreamEvent) => void;
  runPython?: typeof runPython; // injectable for tests
  provider?: ModelProvider; // injectable for tests
  onTitle?: (title: string) => void;
  saveAssistant?: (blocks: MessageBlock[]) => void;
  isFirstTurn?: boolean;
  userMessage?: string;
}

/**
 * The Julius loop (provider-neutral): stream text → execute tool calls →
 * feed results back → repeat. Every model event goes through ctx.emit;
 * the caller is the SSE route.
 */
export async function runAgent(ctx: AgentContext): Promise<void> {
  const { emit, datasets, history } = ctx;
  const provider = ctx.provider ?? defaultProvider();

  if (ctx.isFirstTurn && ctx.userMessage) {
    const title = (await provider.generateTitle(ctx.userMessage)).trim();
    ctx.onTitle?.(title);
  }

  const apiMessages = toProviderMessages(history);
  const system = buildSystemPrompt(datasets);

  // Everything printed across the WHOLE conversation grounds later chart calls
  // (a model may chart in a turn after the one that printed the values).
  let groundedStdout = apiMessages
    .map((m) => (m.role === "tool_results" ? m.results.map((r) => r.content).join(" ") : ""))
    .join(" ");

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await provider.runTurn({
      system,
      messages: apiMessages,
      tools: PROVIDER_TOOLS,
      onTextDelta: (text) => emit({ type: "text", text }),
    });

    // Execute this turn's tool calls in order; collect blocks to persist and
    // the matching tool results to feed back (all results go into ONE message).
    const blocks: MessageBlock[] = [];
    const assistantBlocks: ProviderMessage = { role: "assistant", blocks: [] };
    const toolResults: { toolUseId: string; content: string; isError: boolean }[] = [];
    const results = toolResults;
    for (const block of result.blocks) {
      if (block.type === "text") {
        if (block.text.trim()) blocks.push({ type: "text", text: block.text });
        assistantBlocks.blocks.push(block);
      } else if (block.type === "tool_use") {
        assistantBlocks.blocks.push(block);
        const input = block.input as Record<string, unknown>;
        if (block.name === "run_python" && typeof input.code === "string") {
          emit({ type: "tool_start", tool: "run_python", code: input.code });
          const run = await (ctx.runPython ?? runPython)(input.code, datasets);
          emit({ type: "tool_result", tool: "run_python", stdout: run.stdout, error: run.error });
          blocks.push({ type: "run", code: input.code, stdout: run.stdout, error: run.error });
          groundedStdout += ` ${run.stdout}`;
          // The model MUST see its own python output to stay grounded.
          const outputText = run.error ? `Error:\n${run.error}` : run.stdout || "(no output)";
          results.push({ toolUseId: block.id, content: outputText.slice(0, 8000), isError: false });
        } else if (block.name === "render_chart" && isValidChart(input)) {
          // Grounding check: every chart value must appear in this turn's printed output.
          const ungrounded = chartValues({ type: "chart", kind: input.kind, title: input.title, labels: input.labels, series: input.series }).filter((v) => !printed(groundedStdout, v));
          if (ungrounded.length > 0) {
            results.push({
              toolUseId: block.id,
              content: `Chart rejected: values ${ungrounded.join(", ")} were never printed. Copy numbers EXACTLY from your printed output.`,
              isError: true,
            });
          } else {
            const chart: MessageBlock = { type: "chart", kind: input.kind, title: input.title, labels: input.labels, series: input.series };
            emit({ type: "chart", chart });
            blocks.push(chart);
            results.push({ toolUseId: block.id, content: "Chart rendered for the user.", isError: false });
          }
        } else {
          results.push({ toolUseId: block.id, content: "Unknown tool or invalid input.", isError: true });
        }
      }
    }

    if (blocks.length) {
      ctx.history.push({ role: "assistant", blocks });
      ctx.saveAssistant?.(blocks);
    }
    if (result.stopReason !== "tool_use") {
      emit({ type: "done" });
      return;
    }
    apiMessages.push(assistantBlocks);
    apiMessages.push({ role: "tool_results", results });
  }
  emit({ type: "error", message: "Turn limit reached. Ask a follow-up to continue." });
}

export function defaultProvider(): ModelProvider {
  const provider = MODEL === "openai" ? new OpenAIProvider() : new AnthropicProvider();
  console.log(`[julius-lite] provider=${provider.name}`);
  return provider;
}

/** Rebuild a provider-neutral replayable history from our persisted blocks. */
export function toProviderMessages(history: AgentContext["history"]): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const turn of history) {
    if (turn.role === "user") {
      const text = turn.blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
      if (text) out.push({ role: "user", text });
      continue;
    }
    const assistant: ProviderMessage = { role: "assistant", blocks: [] };
    const results: { toolUseId: string; content: string; isError: boolean }[] = [];
    let n = 0;
    for (const block of turn.blocks) {
      if (block.type === "text" && block.text.trim()) {
        assistant.blocks.push({ type: "text", text: block.text });
      } else if (block.type === "run") {
        n++;
        assistant.blocks.push({ type: "tool_use", id: `replay_run_${n}`, name: "run_python", input: { code: block.code } });
        results.push({ toolUseId: `replay_run_${n}`, content: block.error ? `Error:\n${block.error}` : block.stdout || "(no output)", isError: false });
      } else if (block.type === "chart") {
        n++;
        assistant.blocks.push({ type: "tool_use", id: `replay_chart_${n}`, name: "render_chart", input: block });
        results.push({ toolUseId: `replay_chart_${n}`, content: "Chart rendered for the user.", isError: false });
      }
    }
    if (assistant.blocks.length) out.push(assistant);
    if (results.length) out.push({ role: "tool_results", results });
  }
  return out;
}

export function buildSystemPrompt(datasets: DatasetRec[]): string {
  let system =
    "You are Julius Lite, an AI data analyst. Answer the user's question. " +
    "Datasets are pre-loaded as pandas DataFrames in a Python sandbox; if there are datasets, `df` is the first one and each has its own variable too.\n" +
    "Workflow: run Python to compute what you need, printing the numbers you will use; when a chart would help, call render_chart immediately after printing (copying values exactly from the output); then write a concise answer with those same numbers.\n" +
    "Do not re-verify values you have already printed. Never state a number that was not printed in a tool result.\n" +
    "Never invent data. If code errors, read the traceback and fix it.\n";
  for (const ds of datasets) {
    system += `\nDataset "${ds.varName}" (${ds.name}), ${ds.preview.rowCount} rows, columns: ${ds.columns.join(", ")}.\nFirst rows:\n${ds.preview.rows.slice(0, 3).map((r) => r.join(" | ")).join("\n")}\n`;
  }
  return system;
}

function isValidChart(input: unknown): input is Omit<Extract<MessageBlock, { type: "chart" }>, "type"> {
  const c = input as Omit<Extract<MessageBlock, { type: "chart" }>, "type"> | null;
  return (
    !!c &&
    ["bar", "line", "pie"].includes(c.kind) &&
    typeof c.title === "string" &&
    Array.isArray(c.labels) &&
    Array.isArray(c.series) &&
    c.series.every((s) => typeof s?.name === "string" && Array.isArray(s?.values) && s.values.every((v) => typeof v === "number"))
  );
}

function chartValues(chart: Extract<MessageBlock, { type: "chart" }>): number[] {
  return chart.series.flatMap((s) => s.values);
}

/** True if a number's common textual forms appear in the model's printed output. */
export function printed(stdout: string, value: number): boolean {
  const forms = new Set<string>([String(Number(value.toFixed(6))), String(Math.round(value)), value.toFixed(1), value.toPrecision(4)]);
  for (const f of forms) {
    if (stdout.includes(f)) return true;
  }
  return false;
}