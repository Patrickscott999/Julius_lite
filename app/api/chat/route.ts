import { NextRequest } from "next/server";
import { openDb, type MessageBlock } from "@/lib/db";
import { runAgent, type DatasetRec } from "@/lib/agent-run";
import type { StreamEvent } from "@/lib/agent-core";
import { makeVarName } from "@/lib/naming";

export const runtime = "nodejs";
export const maxDuration = 300;

interface DatasetRow {
  name: string;
  path: string;
  columns: string;
  preview: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { taskId: string; message: string };
  const message = (body.message ?? "").trim();
  if (!body.taskId || !message) {
    return Response.json({ error: "taskId and message are required" }, { status: 400 });
  }

  const db = openDb();
  const task = db.prepare("SELECT id, title FROM tasks WHERE id = ?").get(body.taskId) as { id: string; title: string } | undefined;
  if (!task) return Response.json({ error: "Task not found" }, { status: 404 });

  const dsRows = db.prepare("SELECT name, path, columns, preview FROM datasets WHERE task_id = ? ORDER BY id").all(body.taskId) as DatasetRow[];
  const datasets: DatasetRec[] = dsRows.map((d) => ({
    name: d.name,
    varName: makeVarName(d.name),
    path: d.path,
    columns: JSON.parse(d.columns) as string[],
    preview: JSON.parse(d.preview),
  }));

  const history = (db.prepare("SELECT role, blocks FROM messages WHERE task_id = ? ORDER BY id").all(body.taskId) as { role: string; blocks: string }[]).map((m) => ({
    role: m.role as "user" | "assistant",
    blocks: JSON.parse(m.blocks) as MessageBlock[],
  }));
  history.push({ role: "user", blocks: [{ type: "text", text: message }] });
  db.prepare("INSERT INTO messages (task_id, role, blocks) VALUES (?, ?, ?)").run(body.taskId, "user", JSON.stringify([{ type: "text", text: message }]));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (event: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      let titleSent = false;
      try {
        await runAgent({
          datasets,
          history,
          emit,
          isFirstTurn: history.length === 1,
          userMessage: message,
          onTitle: (title) => {
            if (!titleSent) {
              titleSent = true;
              db.prepare("UPDATE tasks SET title = ? WHERE id = ?").run(title, body.taskId);
              emit({ type: "title", taskTitle: title, taskId: body.taskId });
            }
          },
          saveAssistant: (blocks) => {
            db.prepare("INSERT INTO messages (task_id, role, blocks) VALUES (?, ?, ?)").run(body.taskId, "assistant", JSON.stringify(blocks));
          },
        });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
        emit({ type: "done" });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}