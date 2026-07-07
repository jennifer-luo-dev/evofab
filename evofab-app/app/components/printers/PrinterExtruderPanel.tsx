"use client";

import { useState } from "react";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrinterExtruderPanelProps {
  printer: PrinterWithStatus;
}

type Tone = "ok" | "error";

async function postMotion(printerId: string, body: unknown) {
  const response = await fetch(`/api/printers/${printerId}/motion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json?.error?.message ?? `Extruder command failed (${response.status}).`;
    const code = json?.error?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
  return json;
}

export function PrinterExtruderPanel({ printer }: PrinterExtruderPanelProps) {
  const status = printer.printer_status?.status ?? "offline";
  const canCommand = status === "idle" || status === "paused";
  const [lengthMm, setLengthMm] = useState(5);
  const [feedrateMmS, setFeedrateMmS] = useState(5);
  const [factorPercent, setFactorPercent] = useState(100);
  const [pressureAdvance, setPressureAdvance] = useState(0.04);
  const [smoothTime, setSmoothTime] = useState(0.04);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(
    null,
  );

  async function run(label: string, body: unknown) {
    setBusy(label);
    setMessage(null);
    try {
      await postMotion(printer.id, body);
      setMessage({ tone: "ok", text: `${label} sent.` });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Extruder command failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text focus:border-teal focus:outline-none";
  const buttonClass =
    "rounded-md border border-border px-2 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Extruder
          </h2>
          <p className="mt-1 text-xs text-muted">
            {canCommand ? "Idle or paused controls" : "Requires idle or paused"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            Extrusion factor (%)
          </span>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={300}
              value={factorPercent}
              onChange={(event) => setFactorPercent(Number(event.target.value))}
              className={inputClass}
            />
            <button
              disabled={busy !== null || !canCommand}
              onClick={() =>
                run("Extrusion factor", {
                  action: "extrusion_factor",
                  factorPercent,
                })
              }
              className={buttonClass}
            >
              Set
            </button>
          </div>
        </label>

        <label className="grid gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            Pressure advance
          </span>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              type="number"
              min={0}
              max={2}
              step={0.01}
              value={pressureAdvance}
              onChange={(event) => setPressureAdvance(Number(event.target.value))}
              className={inputClass}
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={smoothTime}
              onChange={(event) => setSmoothTime(Number(event.target.value))}
              className={inputClass}
            />
            <button
              disabled={busy !== null || !canCommand}
              onClick={() =>
                run("Pressure advance", {
                  action: "pressure_advance",
                  pressureAdvance,
                  smoothTime,
                })
              }
              className={buttonClass}
            >
              Set
            </button>
          </div>
        </label>

        <label className="grid gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            Filament length (mm)
          </span>
          <input
            type="number"
            min={1}
            max={20}
            value={lengthMm}
            onChange={(event) => setLengthMm(Number(event.target.value))}
            className={inputClass}
          />
          <div className="flex flex-wrap gap-1.5">
            {[50, 25, 10, 5, 1].map((value) => (
              <button
                key={value}
                onClick={() => setLengthMm(value)}
                className={buttonClass}
              >
                {value}
              </button>
            ))}
          </div>
        </label>

        <label className="grid gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            Feedrate (mm/s)
          </span>
          <input
            type="number"
            min={1}
            max={10}
            value={feedrateMmS}
            onChange={(event) => setFeedrateMmS(Number(event.target.value))}
            className={inputClass}
          />
          <div className="flex flex-wrap gap-1.5">
            {[10, 5, 2, 1].map((value) => (
              <button
                key={value}
                onClick={() => setFeedrateMmS(value)}
                className={buttonClass}
              >
                {value}
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          disabled={busy !== null || !canCommand}
          onClick={() =>
            run("Retract", {
              action: "retract",
              lengthMm,
              feedrateMmMin: feedrateMmS * 60,
            })
          }
          className={buttonClass}
        >
          Retract
        </button>
        <button
          disabled={busy !== null || !canCommand}
          onClick={() =>
            run("Extrude", {
              action: "extrude",
              lengthMm,
              feedrateMmMin: feedrateMmS * 60,
            })
          }
          className={buttonClass}
        >
          Extrude
        </button>
      </div>

      {message && (
        <p
          className={
            message.tone === "error"
              ? "mt-3 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-xs text-red"
              : "mt-3 rounded-md border border-green/30 bg-green/10 px-3 py-2 text-xs text-green"
          }
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
