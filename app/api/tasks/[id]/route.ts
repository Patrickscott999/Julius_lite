import { NextResponse } from "next/server";
import { openDb, type MessageBlock } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = openDb();
  const task = db.prepare("SELECT id, title FROM tasks WHERE id = ?").get(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const messages = db.prepare("SELECT role, blocks FROM messages WHERE task_id = ? ORDER BY id").all(id) as { role: string; blocks: string }[];
  const datasets = db.prepare("SELECT id, name, columns, preview FROM datasets WHERE task_id = ? ORDER BY id").all(id) as unknown as Record<string, string>[];
  return NextResponse.json({
    task,
    messages: messages.map((m) => ({ role: m.role, blocks: JSON.parse(m.blocks) as MessageBlock[] })),
    datasets: datasets.map((d) => ({ id: d.id, name: d.name, columns: JSON.parse(d.columns), preview: JSON.parse(d.preview) })),
  });
}