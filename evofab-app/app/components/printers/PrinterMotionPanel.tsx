"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrinterMotionPanelProps {
  printer: PrinterWithStatus;
}

type Tone = "idle" | "ok" | "error";

async function postMotion(printerId: string, body: unknown) {
  const response = await fetch(`/api/printers/${printerId}/motion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json?.error?.message ?? `Motion command failed (${response.status}).`;
    const code = json?.error?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
  return json;
}

export function PrinterMotionPanel({ printer }: PrinterMotionPanelProps) {
  const router = useRouter();
  const status = printer.printer_status?.status ?? "offline";
  const hotendTemp = printer.printer_status?.hotend_temp ?? null;
  const canSendMotion = status !== "printing";
  const canExtrude = canSendMotion && (hotendTemp ?? 0) >= 170;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string }>({
    tone: "idle",
    text: "",
  });

  async function run(label: string, body: unknown) {
    setBusy(label);
    setMessage({ tone: "idle", text: "" });
    try {
      await postMotion(printer.id, body);
      setMessage({ tone: "ok", text: `${label} sent.` });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Motion command failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  const buttonClass =
    "rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-teal)] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <div className="grid grid-cols-4 gap-2">
        <button
          className={buttonClass}
          disabled={busy !== null || !canSendMotion}
          onClick={() => run("Home", { action: "home" })}
        >
          Home
        </button>
        <button
          className={buttonClass}
          disabled={busy !== null || !canSendMotion}
          onClick={() =>
            run("X+", {
              action: "jog",
              axis: "x",
              distanceMm: 1,
              feedrateMmMin: 1200,
            })
          }
        >
          X+
        </button>
        <button
          className={buttonClass}
          disabled={busy !== null || !canSendMotion}
          onClick={() =>
            run("Y+", {
              action: "jog",
              axis: "y",
              distanceMm: 1,
              feedrateMmMin: 1200,
            })
          }
        >
          Y+
        </button>
        <button
          className={buttonClass}
          disabled={busy !== null || !canSendMotion}
          onClick={() =>
            run("Z+", {
              action: "jog",
              axis: "z",
              distanceMm: 0.5,
              feedrateMmMin: 600,
            })
          }
        >
          Z+
        </button>
        <button
          className={buttonClass}
          disabled={busy !== null || !canSendMotion}
          onClick={() => run("Baby+", { action: "babystep", deltaMm: 0.02 })}
        >
          Baby+
        </button>
        <button
          className={buttonClass}
          disabled={busy !== null || !canSendMotion}
          onClick={() => run("Baby-", { action: "babystep", deltaMm: -0.02 })}
        >
          Baby-
        </button>
        <button
          className={buttonClass}
          disabled={busy !== null || !canExtrude}
          onClick={() =>
            run("Extrude", {
              action: "extrude",
              lengthMm: 5,
              feedrateMmMin: 300,
            })
          }
        >
          E+
        </button>
        <button
          className={buttonClass}
          disabled={busy !== null || !canExtrude}
          onClick={() =>
            run("Retract", {
              action: "retract",
              lengthMm: 5,
              feedrateMmMin: 300,
            })
          }
        >
          E-
        </button>
      </div>
      {message.text && (
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
