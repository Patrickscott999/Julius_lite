import { describe, it, expect } from "vitest";
import { splitCsvLine, previewCsv } from "../csv";
import { makeVarName } from "../naming";

describe("splitCsvLine", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("keeps commas inside quoted fields", () => {
    expect(splitCsvLine("name,note")).toEqual(["name", "note"]);
    expect(splitCsvLine('name,"hello, world"')).toEqual(["name", "hello, world"]);
  });
  it("handles embedded quotes", () => {
    expect(splitCsvLine('"say ""hi"""')).toEqual(['say "hi"']);
  });
  it("keeps empty trailing fields", () => {
    expect(splitCsvLine("a,,")).toEqual(["a", "", ""]);
  });
});

describe("previewCsv", () => {
  it("extracts header, sample rows and full row count", () => {
    const csv = "month,revenue\nJan,100\nFeb,200\nMar,300\nApr,400\n";
    const p = previewCsv(csv, 2);
    expect(p.header).toEqual(["month", "revenue"]);
    expect(p.rows).toEqual([["Jan", "100"], ["Feb", "200"]]);
    expect(p.rowCount).toBe(4);
  });
  it("returns empty when the csv is blank", () => {
    expect(previewCsv("\n\n")).toEqual({ header: [], rows: [], rowCount: 0 });
  });
});

describe("makeVarName", () => {
  it("slugifies dataset names to python identifiers", () => {
    expect(makeVarName("Monthly Revenue.csv")).toBe("df_monthly_revenue");
    expect(makeVarName("Q4--report!.CSV")).toBe("df_q4_report");
    expect(makeVarName(".csv")).toBe("df_dataset");
  });
});