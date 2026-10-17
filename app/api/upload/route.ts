import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDb } from "@/lib/db";
import { makeVarName } from "@/lib/naming";
import { previewCsv } from "@/lib/csv";
import { xlsxToCsv } from "@/lib/xlsx";

export const runtime = "nodejs";

/** Best-effort one-time column add for databases created before downloads. */
function ensureOriginalPathColumn(db: ReturnType<typeof openDb>): void {
  try {
    db.exec("ALTER TABLE datasets ADD COLUMN original_path TEXT");
  } catch {
    // column already exists
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const taskId = form.get("taskId");
  if (!(file instanceof File) || typeof taskId !== "string") {
    return NextResponse.json({ error: "file and taskId are required" }, { status: 400 });
  }
  const isXlsx = /\.xlsx$/i.test(file.name);
  const isCsv = /\.csv$/i.test(file.name);
  if (!isXlsx && !isCsv) {
    return NextResponse.json({ error: "Only .csv and .xlsx files are supported" }, { status: 415 });
  }

  const dir = path.join(process.cwd(), ".data", "uploads", taskId);
  fs.mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());

  // Store the untouched original for downloads (the r2-equivalent serving path).
  const originalPath = path.join(dir, `${id}-${file.name}`);
  fs.writeFileSync(originalPath, bytes);

  // The sandbox always receives CSV.
  let csvText: string;
  let storedName = file.name;
  if (isXlsx) {
    try {
      csvText = (await xlsxToCsv(bytes)).csv;
    } catch {
      return NextResponse.json({ error: "Could not parse this .xlsx file" }, { status: 400 });
    }
    storedName = `${file.name}.csv`;
  } else {
    csvText = bytes.toString("utf8");
  }
  const csvPath = path.join(dir, `${id}-${storedName}`);
  fs.writeFileSync(csvPath, csvText);

  const preview = previewCsv(csvText);
  if (preview.header.length === 0) {
    return NextResponse.json({ error: "File appears empty" }, { status: 400 });
  }

  const varName = makeVarName(file.name);
  const db = openDb();
  ensureOriginalPathColumn(db);
  db.prepare("INSERT INTO datasets (id, task_id, name, path, original_path, columns, preview) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id, taskId, file.name, csvPath, originalPath, JSON.stringify(preview.header), JSON.stringify(preview),
  );

  return NextResponse.json({ dataset: { id, name: file.name, varName, columns: preview.header, preview } });
}