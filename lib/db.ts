import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "run"; code: string; stdout: string; error?: string }
  | { type: "chart"; title: string; kind: "bar" | "line" | "pie"; labels: string[]; series: { name: string; values: number[] }[] };

const DATA_DIR = path.join(process.cwd(), ".data");

/** One shared database for the process; schema created on first use. */
export function openDb(dbPath?: string): Database.Database {
  const file = dbPath ?? path.join(DATA_DIR, "app.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
      blocks     TEXT NOT NULL, -- JSON MessageBlock[]
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, id);
    CREATE TABLE IF NOT EXISTS datasets (
      id       TEXT PRIMARY KEY,
      task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      name     TEXT NOT NULL,
      path     TEXT NOT NULL,  -- absolute path on disk
      columns  TEXT NOT NULL,  -- JSON string[]
      preview  TEXT NOT NULL   -- JSON { header: string[], rows: string[][], rowCount: number }
    );
  `);
  return db;
}