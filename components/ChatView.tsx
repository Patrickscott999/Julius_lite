"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { MessageBlock } from "@/lib/db";
import Blocks from "./Blocks";

interface DatasetSummary {
  id: string;
  name: string;
  varName: string;
  columns: string[];
  preview: { header: string[]; rows: string[][]; rowCount: number };
}

/**
 * Stream protocol mirroring lib/agent-core.ts StreamEvent (client copy to avoid
 * pulling node deps into the bundle; keep the two in sync).
 */
type ViewEvent =
  | { type: "title"; taskTitle: string; taskId: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: "run_python"; code: string }
  | { type: "tool_result"; tool: "run_python"; stdout: string; error?: string }
  | { type: "chart"; chart: Extract<MessageBlock, { type: "chart" }> }
  | { type: "done" }
  | { type: "error"; message: string };

export default function ChatView() {
  const { id: taskId } = useParams<{ id: string }>();
  const [title, setTitle] = useState<string>("New Task");
  const [blocks, setBlocks] = useState<MessageBlock[]>([]); // live streaming blocks
  const [turns, setTurns] = useState<{ role: string; blocks: MessageBlock[] }[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/tasks/${taskId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setTitle(d.task.title);
        setTurns(d.messages);
        setDatasets(d.datasets);
      })
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, blocks]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setTurns((prev) => [...prev, { role: "user", blocks: [{ type: "text", text: message }] }]);
    setInput("");
    setBusy(true);
    setBlocks([]);

    // Stream the NDJSON agent protocol, accumulating a live assistant turn.
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, message }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const live: MessageBlock[] = [];

    const apply = (event: ViewEvent) => {
      switch (event.type) {
        case "title":
          setTitle(event.taskTitle);
          router.refresh(); // sidebar task titles
          break;
        case "text": {
          const last = live[live.length - 1];
          if (last?.type === "text") last.text += event.text;
          else live.push({ type: "text", text: event.text });
          break;
        }
        case "tool_start":
          live.push({ type: "run", code: event.code, stdout: "" });
          break;
        case "tool_result": {
          const run = live[live.length - 1];
          if (run?.type === "run") {
            run.stdout = event.stdout;
            run.error = event.error;
          }
          break;
        }
        case "chart":
          live.push({ type: "chart", kind: event.chart.kind, title: event.chart.title, labels: event.chart.labels, series: event.chart.series });
          break;
        case "error":
          live.push({ type: "text", text: `⚠️ ${event.message}` });
          break;
        case "done":
          break;
      }
      setBlocks([...live]);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          try {
            apply(JSON.parse(line) as ViewEvent);
          } catch {
            // skip malformed line
          }
        }
      }
    }
    setTurns((prev) => [...prev, { role: "assistant", blocks: [...live] }]);
    setBlocks([]);
    setBusy(false);
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("taskId", taskId as string);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const d = await res.json();
    if (d.dataset) {
      setDatasets((prev) => [...prev, { ...d.dataset, varName: d.dataset.varName }]);
      await send(`I uploaded ${file.name}. Show me a summary of what's in this dataset.`);
    } else {
      alert(d.error ?? "Upload failed");
    }
  }

  const empty = turns.length === 0 && blocks.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-6">
        <h1 className="truncate text-sm text-[var(--muted)]">{title}</h1>
        <div className="flex items-center gap-3 text-sm">
          {datasets.map((d) => (
            <a key={d.id} href={`/api/download/${d.id}`} download className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]" title="Download original file">
              {d.name} <span className="text-[#55585e]">({d.preview.rowCount} rows)</span> ⭳
            </a>
          ))}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.xlsx"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--panel)]">
            + Upload CSV/XLSX
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
            <h2 className="text-3xl font-semibold tracking-tight">What can I do for you today?</h2>
            <div className="flex flex-wrap justify-center gap-2 text-sm">
              {["Clean my Excel sheet", "Summarize this dataset", "Forecast next quarter", "Find anomalies in my data"].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[var(--muted)] hover:bg-[var(--panel)]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
            {turns.map((turn, i) => (
              <div key={i} className={turn.role === "user" ? "justify-end text-right" : ""}>
                {turn.role === "user" ? (
                  <div className="inline-block max-w-[80%] rounded-2xl rounded-br-md bg-[var(--accent)] px-4 py-2.5 text-left">
                    <Blocks blocks={turn.blocks} plain />
                  </div>
                ) : (
                  <Blocks blocks={turn.blocks} />
                )}
              </div>
            ))}
            {blocks.length > 0 && <Blocks blocks={blocks} streaming />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 px-6 pb-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            disabled={busy}
            rows={2}
            placeholder={busy ? "Julius is thinking… (streaming, code runs, results flow back)" : "Ask me about your data…"}
            className="w-full resize-none bg-transparent px-2 text-sm outline-none placeholder:text-[#55585e]"
          />
          <div className="flex items-center justify-between px-2">
            <span className="text-xs text-[#55585e]">Enter to send · Shift+Enter for newline</span>
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}