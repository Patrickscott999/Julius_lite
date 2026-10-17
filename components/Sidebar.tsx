"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Task {
  id: string;
  title: string;
  message_count: number;
}

export default function Sidebar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .catch(() => {});
  }, [pathname]);

  async function newTask() {
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", { method: "POST" });
      const { taskId } = await res.json();
      router.push(`/chat/${taskId}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] p-3">
      <Link href="/" className="mb-4 px-2 text-xl font-bold tracking-tight text-[var(--accent)]">
        Julius <span className="text-[var(--muted)] font-normal text-sm">lite</span>
      </Link>
      <button
        onClick={newTask}
        disabled={creating}
        className="mb-5 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[#1c1e24] px-3 py-2 text-left text-sm hover:bg-[#22252c] disabled:opacity-50"
      >
        <span className="text-[var(--accent)]">✎</span> New Task
      </button>
      <div className="px-2 pb-1 text-xs text-[var(--muted)]">Recents</div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {tasks.map((t) => (
          <Link
            key={t.id}
            href={`/chat/${t.id}`}
            className="block truncate rounded-md px-2 py-1.5 text-sm text-[var(--muted)] hover:bg-[#1c1e24] hover:text-[var(--text)]"
          >
            {t.title}
          </Link>
        ))}
        {tasks.length === 0 && <div className="px-2 py-1.5 text-sm text-[#55585e]">No tasks yet</div>}
      </nav>
      <div className="border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">Julius Lite · local sandbox</div>
    </aside>
  );
}