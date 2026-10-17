"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  async function newTask() {
    setCreating(true);
    const res = await fetch("/api/tasks", { method: "POST" });
    const { taskId } = await res.json();
    router.push(`/chat/${taskId}`);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">What can I do for you today?</h1>
        <p className="mt-3 text-[var(--muted)]">Create a task, upload a CSV, and talk to your data.</p>
      </div>
      <button
        onClick={newTask}
        disabled={creating}
        className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {creating ? "Creating…" : "New Task"}
      </button>
    </div>
  );
}