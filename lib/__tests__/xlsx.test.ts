import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { xlsxToCsv } from "../xlsx";

async function workbookCsvBytes(rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  for (const row of rows) ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("xlsxToCsv", () => {
  it("converts the first sheet to CSV with a quoted-header-safe join", async () => {
    const bytes = await workbookCsvBytes([
      ["month", "revenue"],
      ["Jan", 100],
      ["Feb, Alaska", 150.5],
      [],
      [null, null, "ignored"],
    ]);
    const { csv, sheetName } = await xlsxToCsv(bytes);
    expect(sheetName).toBe("Data");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("month,revenue");
    expect(lines[2]).toBe('"Feb, Alaska",150.5');
    // the empty [] row is dropped, but row 4's column-3 value keeps its position
    expect(lines[3]).toBe(",,ignored");
  });

  it("serializes numbers without float noise", async () => {
    const bytes = await workbookCsvBytes([["n"], [3.14], [210]]);
    const { csv } = await xlsxToCsv(bytes);
    expect(csv.trim().split("\n")).toEqual(["n", "3.14", "210"]);
  });
});