"use client";

import { useMemo, useState } from "react";
import { overrideUnavailableReason } from "@/app/lib/printer-overrides";
import type { PrinterStatus } from "@/app/types/printer";

interface RuntimeOverridePanelProps {
  jobId: string;
  jobActive: boolean;
  printerStatus: PrinterStatus | null;
}

type OverrideAction =
  | "speed_factor"
  | "flow_factor"
  | "fan_speed"
  | "nozzle_target"
  | "bed_target"
  | "babystep_z";

interface OverrideControl {
  action: OverrideAction;
  label: string;
  unit: string;
  step: string;
  value: number;
}

async function postOverride(
  jobId: string,
  action: OverrideAction,
  value: number,
) {
  const response = await fetch(`/api/jobs/${jobId}/overrides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, value }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json?.error?.message ?? `Override command failed (${response.status}).`;
    const code = json?.error?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
  return json;
}

export function RuntimeOverridePanel({
  jobId,
  jobActive,
  printerStatus,
}: RuntimeOverridePanelProps) {
  const [values, setValues] = useState({
    speed_factor: 100,
    flow_factor: 100,
    fan_speed: 0,
    nozzle_target: printerStatus?.hotend_target ?? 0,
    bed_target: printerStatus?.bed_target ?? 0,
    babystep_z: 0.02,
  });
  const [busy, setBusy] = useState<OverrideAction | null>(null);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const unavailableReason = jobActive
    ? overrideUnavailableReason({
        status: printerStatus?.status ?? "unknown",
      })
    : "No active print.";
  const disabled = busy !== null || unavailableReason !== null;
  const controls = useMemo<OverrideControl[]>(
    () => [
      {
        action: "speed_factor",
        label: "Speed",
        unit: "%",
        step: "1",
        value: values.speed_factor,
      },
      {
        action: "flow_factor",
        label: "Flow",
        unit: "%",
        step: "1",
        value: values.flow_factor,
      },
      {
        action: "fan_speed",
        label: "Fan",
        unit: "%",
        step: "1",
        value: values.fan_speed,
      },
      {
        action: "nozzle_target",
        label: "Nozzle",
        unit: "C",
        step: "1",
        value: values.nozzle_target,
      },
      {
        action: "bed_target",
        label: "Bed",
        unit: "C",
        step: "1",
        value: values.bed_target,
      },
      {
        action: "babystep_z",
        label: "Baby Z",
        unit: "mm",
        step: "0.01",
        value: values.babystep_z,
      },
    ],
    [values],
  );

  async function apply(action: OverrideAction) {
    setBusy(action);
    setMessage(null);
    try {
      const payload = await postOverride(jobId, action, values[action]);
      const applied = payload?.override?.value;
      setMessage({
        tone: "ok",
        text:
          typeof applied === "number"
            ? `${action.replaceAll("_", " ")} applied: ${applied}`
            : `${action.replaceAll("_", " ")} applied.`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Override command failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Runtime Overrides
          </h2>
          <p className="mt-1 text-xs text-muted">
            {unavailableReason ?? "Active print controls"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {controls.map((control) => (
          <div key={control.action} className="rounded-lg bg-bg p-3">
            <label className="text-[10px] uppercase tracking-wider text-muted">
              {control.label}
              <span className="ml-1 normal-case">({control.unit})</span>
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="number"
                step={control.step}
                value={control.value}
                disabled={busy !== null}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [control.action]: Number(event.target.value),
                  }))
                }
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text focus:border-teal focus:outline-none disabled:opacity-40"
              />
              <button
                disabled={disabled}
                title={unavailableReason ?? `Apply ${control.label}`}
                onClick={() => apply(control.action)}
                className="rounded-md border border-border px-2 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
              >
                Set
              </button>
            </div>
          </div>
        ))}
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
