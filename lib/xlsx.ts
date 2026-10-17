import ExcelJS from "exceljs";

/**
 * Convert the first non-empty worksheet of an .xlsx buffer to CSV text, so the
 * upload pipeline (preview, pandas, prompts) only ever deals with CSV.
 */
export async function xlsxToCsv(bytes: Buffer): Promise<{ csv: string; sheetName: string }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  const ws = wb.worksheets.find((w) => w.rowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new Error("Workbook has no sheets");

  const lines: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      // pad gaps so column positions stay aligned
      for (let i = cells.length; i < colNumber - 1; i++) cells.push("");
      cells.push(csvField(cellValue(cell)));
    });
    // drop fully empty rows (common in hand-built sheets)
    if (cells.some((c) => c !== "")) lines.push(cells.join(","));
  });

  return { csv: lines.join("\n") + "\n", sheetName: ws.name };
}

function cellValue(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("text" in v) return String((v as { text: string }).text);
    if ("result" in v) return String((v as { result: unknown }).result ?? "");
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }
  // numbers: avoid float noise (0.1+0.2 style artifacts from sheet floats)
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
  return String(v);
}

function csvField(field: string): string {
  if (field === "" ) return "";
  if ((field + "").match(/[",\n]/)) {
    return `"${String(field).replace(/"/g, '""')}"`;
  }
  return field;
}

const noop = () => {}; // eslint marker: file is ESM, no runtime deps beyond exceljs
void noop;