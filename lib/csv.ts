/** Minimal RFC-4180-ish CSV line parse (quoted fields, comma sep). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out;
}

/** Header + up to `maxRows` sample rows + total data-row count. */
export function previewCsv(csv: string, maxRows = 4) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [] as string[], rows: [] as string[][], rowCount: 0 };
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1, 1 + maxRows).map((l) => splitCsvLine(l));
  return { header, rows, rowCount: lines.length - 1 };
}