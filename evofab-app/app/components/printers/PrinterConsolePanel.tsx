"use client";

import { useState } from "react";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrinterConsolePanelProps {
  printer: PrinterWithStatus;
}

interface ConsoleEntry {
  id: string;
  command: string;
  response: string;
  tone: "ok" | "error";
}

export function PrinterConsolePanel({ printer }: PrinterConsolePanelProps) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);

  async function send() {
    setBusy(true);
    try {
      const response = await fetch(`/api/printers/${printer.id}/console`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error?.code;
        const text =
          body?.error?.message ?? `Console send failed (${response.status}).`;
        throw new Error(code ? `${code}: ${text}` : text);
      }
      setEntries((current) => [
        {
          id: crypto.randomUUID(),
          command,
          response: body.console.response,
          tone: "ok",
        },
        ...current,
      ]);
      setCommand("");
    } catch (error) {
      setEntries((current) => [
        {
          id: crypto.randomUUID(),
          command,
          response:
            error instanceof Error ? error.message : "Console send failed.",
          tone: "error",
        },
        ...current,
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
        Advanced Console
      </h2>
      <div className="mt-3 grid gap-2">
        <textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={3}
          className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-text focus:border-teal focus:outline-none"
        />
        <button
          disabled={busy}
          onClick={send}
          className="justify-self-start rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={
              entry.tone === "error"
                ? "rounded-md border border-red/30 bg-red/10 px-3 py-2"
                : "rounded-md border border-border bg-bg px-3 py-2"
            }
          >
            <p className="font-mono text-xs text-text">{entry.command}</p>
            <p
              className={
                entry.tone === "error"
                  ? "mt-1 text-xs text-red"
                  : "mt-1 text-xs text-muted"
              }
            >
              {entry.response}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
