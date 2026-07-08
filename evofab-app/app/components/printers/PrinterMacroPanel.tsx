"use client";

import { useMemo, useState } from "react";
import { listCuratedMacros } from "@/app/lib/printer-macros";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrinterMacroPanelProps {
  printer: PrinterWithStatus;
}

async function postMacro(printerId: string, macroId: string) {
  const response = await fetch(`/api/printers/${printerId}/macros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ macro_id: macroId }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json?.error?.message ?? `Macro command failed (${response.status}).`;
    const code = json?.error?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
  return json;
}

export function PrinterMacroPanel({ printer }: PrinterMacroPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const status = printer.printer_status?.status ?? "unknown";
  const macros = useMemo(() => listCuratedMacros({ status }), [status]);

  async function runMacro(macroId: string, label: string) {
    setBusy(macroId);
    setMessage(null);
    try {
      await postMacro(printer.id, macroId);
      setMessage({ tone: "ok", text: `${label} sent.` });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Macro command failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <div className="grid grid-cols-2 gap-2">
        {macros.map((macro) => (
          <button
            key={macro.id}
            disabled={busy !== null || !macro.enabled}
            title={macro.reason ?? macro.label}
            onClick={() => runMacro(macro.id, macro.label)}
            className="rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-teal)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {macro.label}
          </button>
        ))}
      </div>
      {message && (
        <p
          className={
            message.tone === "error"
              ? "mt-2 text-xs text-[var(--color-red)]"
              : "mt-2 text-xs text-[var(--color-green)]"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
