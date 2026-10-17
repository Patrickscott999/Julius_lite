import fs from "node:fs";
import { openDb } from "@/lib/db";

export const runtime = "nodejs";

/** Serve an uploaded dataset's original file — the local stand-in for r2.julius.ai object storage. */
export async function GET(_req: Request, { params }: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await params;
  const db = openDb();
  const ds = db.prepare("SELECT name, path, original_path FROM datasets WHERE id = ?").get(datasetId) as
    | { name: string; path: string; original_path: string | null }
    | undefined;
  if (!ds) return new Response("Dataset not found", { status: 404 });

  const servePath = ds.original_path ?? ds.path;
  if (!fs.existsSync(servePath)) return new Response("File missing", { status: 410 });

  const bytes = fs.readFileSync(servePath);
  const contentType = /\.xlsx$/i.test(ds.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${ds.name.replace(/"/g, "") }"`,
    },
  });
}