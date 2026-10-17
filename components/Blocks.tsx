"use client";

import type { MessageBlock } from "@/lib/db";
import Markdown from "./Markdown";
import ChartView from "./ChartView";

/** Renders the model's persisted blocks: text (markdown), runs, charts. */
export default function Blocks({ blocks, streaming, plain }: { blocks: MessageBlock[]; streaming?: boolean; plain?: boolean }) {
  return (
    <div className="space-y-3 text-left">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return plain ? (
              <span key={i} className="inline whitespace-pre-wrap">{block.text}</span>
            ) : (
              <Markdown key={i} text={block.text} streaming={streaming && i === blocks.length - 1} />
            );
          case "run":
            return (
              <div key={i} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] text-left">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]">
                  <span>🐍 Python</span>
                  {block.error ? <span className="text-red-400">error</span> : <span className="text-emerald-400">ok</span>}
                </div>
                <pre className="overflow-x-auto px-3 py-2 text-xs text-sky-300">{block.code}</pre>
                {(block.stdout || block.error) && (
                  <pre className="max-h-72 overflow-auto border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                    {block.error ? block.error : block.stdout}
                  </pre>
                )}
              </div>
            );
          case "chart":
            return <ChartView key={i} chart={block} />;
        }
      })}
      {streaming && blocks.length === 0 && <div className="text-sm text-[var(--muted)]">Thinking…</div>}
    </div>
  );
}