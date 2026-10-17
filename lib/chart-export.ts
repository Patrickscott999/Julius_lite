import type { MessageBlock } from "@/lib/db";

/**
 * Chart export (client-side, no server round-trip):
 * - PNG: serialize the rendered SVG into a canvas and take its pixels.
 * - CSV: flatten the series data directly.
 */

export function downloadCsv(chart: Extract<MessageBlock, { type: "chart" }>, title: string): void {
  const rows: string[] = [chart.labels.length ? "label," + chart.series.map((s) => csvSafe(s.name)).join(",") : "value"];
  chart.labels.forEach((label, i) => {
    rows.push(csvSafe(label) + "," + chart.series.map((s) => s.values[i] ?? "").join(","));
  });
  triggerDownload(rows.join("\n"), `${safeName(title)}.csv`, "text/csv");
}

export function downloadSvgPng(svg: SVGSVGElement, title: string): void {
  const data = new XMLSerializer().serializeToString(svg);
  // The SVG element declares viewBox but not pixel size; scale to 2x for crisp export.
  const rect = svg.getBoundingClientRect();
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    // The SVG rect at 2x fills the whole canvas; no white fill so dark-theme
    // exports keep their own opaque panel background edge-to-edge.
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName(title)}.png`;
    a.click();
  };
  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(data)));
}

function triggerDownload(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvSafe(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function safeName(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "chart";
}