"use client";

import { useMemo } from "react";

/**
 * Markdown-lite renderer (no deps): code fences, GFM tables, headings, lists,
 * bold/inline-code/links. Data-analyst output is mostly tables + fences, which
 * is why tables come before generic paragraphs.
 */
export default function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const parts = useMemo(() => parse(text), [text]);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {parts.map((p, i) => (
        <Part key={i} part={p} />
      ))}
      {streaming && <span className="inline-block h-4 w-2 animate-pulse bg-[var(--accent)]" />}
    </div>
  );
}

type Part =
  | { kind: "fence"; lang: string; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

function parse(text: string): Part[] {
  const lines = text.split("\n");
  const parts: Part[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      parts.push({ kind: "paragraph", text: para.join(" ") });
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushPara();
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      parts.push({ kind: "fence", lang, text: buf.join("\n") });
      i++;
      continue;
    }
    if (line.trimStart().startsWith("|") && i + 1 < lines.length && /\|[\s:-]*\|[\s|:-]*$/.test(lines[i + 1].trim())) {
      flushPara();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(splitRow(lines[i++]));
      parts.push({ kind: "table", header, rows });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      parts.push({ kind: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
      parts.push({ kind: "list", items });
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara();
  return parts;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function Part({ part }: { part: Part }) {
  switch (part.kind) {
    case "fence":
      return <pre className="overflow-x-auto rounded-lg bg-[var(--panel)] border border-[var(--border)] p-3 text-xs">{part.text}</pre>;
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead className="bg-[var(--panel)]">
              <tr>{part.header.map((h, i) => <th key={i} className="border-b border-[var(--border)] px-3 py-1.5 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {part.rows.slice(0, 50).map((r, ri) => (
                <tr key={ri} className="border-b border-[#1c1e24] last:border-0">
                  {r.map((c, ci) => <td key={ci} className="px-3 py-1.5 text-[var(--muted)]">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "heading": {
      const size = part.level <= 2 ? "text-base font-semibold" : "text-sm font-medium";
      return <div className={size}>{inline(part.text)}</div>;
    }
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-5">
          {part.items.map((t, i) => <li key={i}>{inline(t)}</li>)}
        </ul>
      );
    case "paragraph":
      return <p>{inline(part.text)}</p>;
  }
}

/** Inline: **bold**, `code`, [label](url). Escapes everything else. */
function inline(text: string) {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let last = 0, m: RegExpExecArray | null, key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(escape(text.slice(last, m.index)));
    if (m[1]) nodes.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2]) nodes.push(<code key={key++} className="rounded bg-[var(--panel)] px-1 py-0.5 text-xs">{m[2]}</code>);
    else if (m[3]) nodes.push(<a key={key++} href={m[4]} className="text-[var(--accent)] underline">{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(escape(text.slice(last)));
  return nodes;
}

function escape(s: string): string {
  return s; // React text nodes are auto-escaped
}