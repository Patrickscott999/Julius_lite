import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { openDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const db = openDb();
  const tasks = db.prepare("SELECT t.id, t.title, t.created_at, COUNT(m.id) AS message_count FROM tasks t LEFT JOIN messages m ON m.task_id = t.id GROUP BY t.id ORDER BY t.created_at DESC").all();
  return NextResponse.json({ tasks });
}

export async function POST() {
  const db = openDb();
  const id = randomUUID();
  db.prepare("INSERT INTO tasks (id, title) VALUES (?, ?)").run(id, "New Task");
  return NextResponse.json({ taskId: id });
}