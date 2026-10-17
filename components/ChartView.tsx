"use client";

import type { MessageBlock } from "@/lib/db";
import { useRef } from "react";
import { downloadCsv, downloadSvgPng } from "@/lib/chart-export";

const COLORS = ["#6c8cff", "#4fd1c5", "#f6ad55", "#f56565", "#9ae6b4", "#d6bcfa"];

/**
 * Pure-SVG chart renderer for the render_chart tool payload. No chart library:
 * bar/line/pie cover the analyst's daily drivers and stay dependency-free.
 * Export buttons serialize the same SVG to PNG / CSV client-side.
 */
export default function ChartView({ chart }: { chart: Extract<MessageBlock, { type: "chart" }> }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 560;
  const H = 320;
  const PAD = 44;
  const hasData = chart.labels.length > 0 && chart.series.some((s) => s.values.length > 0);

  if (!hasData) return null;

  const max = Math.max(...chart.series.flatMap((s) => s.values)) || 1;
  const min = Math.min(0, ...chart.series.flatMap((s) => s.values));
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const yFor = (v: number) => PAD + plotH - ((v - min) / (max - min || 1)) * plotH;
  const xFor = (i: number) => PAD + (chart.labels.length === 1 ? plotW / 2 : (i / (chart.labels.length - 1)) * plotW);

  const body =
    chart.kind === "pie" ? renderPie(chart) : renderAxes();

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">{chart.title}</div>
        <ExportRow chartRef={svgRef} chart={chart} />
      </div>
      {body}
      <Legend chart={chart} />
    </div>
  );

  function renderAxes() {
    return (
      <>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block w-full">
          <rect x={0} y={0} width={W} height={H} fill="#14161a" />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = yFor(min + t * (max - min));
            return (
              <g key={t}>
                <line x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="#22242a" strokeWidth={1} />
                <text x={W - PAD + 6} y={y + 4} textAnchor="start" fontSize={10} fill="#6b6f78">{fmt(min + t * (max - min))}</text>
              </g>
            );
          })}
          {chart.kind === "bar"
            ? chart.series.map((s, si) =>
                s.values.map((v, i) => {
                  const bw = (plotW / chart.labels.length) / chart.series.length;
                  const x = PAD + (i / chart.labels.length) * plotW + si * bw;
                  return <rect key={`${si}-${i}`} x={x + 1} y={yFor(v)} width={Math.max(bw - 2, 2)} height={yFor(min) - yFor(v)} fill={COLORS[si % COLORS.length]} opacity={0.9} rx={2} />;
                }),
              )
            : chart.series.map((s, si) => (
                <polyline key={si} fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth={2}
                  points={s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ")} />
              ))}
          {chart.labels.map((l, i) => (
            <text key={i} x={chart.kind === "bar" ? PAD + (i / chart.labels.length) * plotW + (plotW / chart.labels.length) / 2 : xFor(i)}
              y={H - PAD + 16} textAnchor="middle" fontSize={10} fill="#6b6f78">
              {chart.labels.length > 8 && i % Math.ceil(chart.labels.length / 8) !== 0 ? "" : l}
            </text>
          ))}
        </svg>
      </>
    );
  }
}

function renderPie(chart: Extract<MessageBlock, { type: "chart" }>) {
  const W = 420;
  const H = 320;
  const values = chart.series[0].values;
  const total = values.reduce((a, b) => a + Math.abs(b), 0) || 1;
  let angle = -Math.PI / 2;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 14;
  const slices = values.map((v, i) => {
    const a0 = angle, a1 = (angle += (Math.abs(v) / total) * Math.PI * 2);
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)] as const;
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)] as const;
    return { path: `M ${cx} ${cy} L ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1[0]} ${p1[1]} Z`, value: v, label: chart.labels[i] };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block max-w-full" style={{ width: 400 }}>
      <rect x={0} y={0} width={W} height={H} fill="#14161a" />
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={COLORS[i % COLORS.length]} opacity={0.9} />
      ))}
    </svg>
  );
}

function Legend({ chart }: { chart: Extract<MessageBlock, { type: "chart" }> }) {
  const values = chart.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-wrap gap-3 pt-2 text-xs text-[var(--muted)]">
      {chart.series.length > 1
        ? chart.series.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              {s.name}
            </span>
          ))
        : chart.kind === "pie" &&
          chart.labels.map((l, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              {l} ({Math.round((values[i] / total || 1) * 100)}%)
            </span>
          ))}
    </div>
  );
}

function ExportRow({ chartRef, chart }: { chartRef: React.RefObject<SVGSVGElement | null>; chart: Extract<MessageBlock, { type: "chart" }> }) {
  return (
    <div className="flex gap-2 text-xs">
      <button
        onClick={() => chartRef.current && downloadSvgPng(chartRef.current, chart.title)}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--muted)] hover:bg-[#22252c]"
      >
        PNG
      </button>
      <button
        onClick={() => downloadCsv(chart, chart.title)}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--muted)] hover:bg-[#22252c]"
      >
        CSV
      </button>
    </div>
  );
}

function fmt(n: number): string {
  return Math.abs(n) >= 100000 || (Math.abs(n) < 1 && n !== 0) ? n.toPrecision(2) : String(Math.round(n * 100) / 100);
}