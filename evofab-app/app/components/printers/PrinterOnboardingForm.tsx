"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PrinterType } from "@/app/types/printer";

interface FormState {
  name: string;
  model: string;
  ip: string;
  port: string;
  type: PrinterType;
  material: string;
  build_volume: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  model: "",
  ip: "",
  port: "7125",
  type: "FDM",
  material: "",
  build_volume: "",
};

export function PrinterOnboardingForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [testMessage, setTestMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/printers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          port: Number(form.port),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const code = json?.error?.code;
        const text =
          json?.error?.message ?? `Printer create failed (${response.status}).`;
        throw new Error(code ? `${code}: ${text}` : text);
      }
      setForm(EMPTY_FORM);
      setMessage({ tone: "ok", text: "Printer added." });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to add printer.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTestBusy(true);
    setTestMessage(null);
    try {
      const response = await fetch("/api/printers/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          port: Number(form.port),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const code = json?.error?.code;
        const text =
          json?.error?.message ??
          `Printer connection test failed (${response.status}).`;
        throw new Error(code ? `${code}: ${text}` : text);
      }

      const moonrakerVersion = json?.info?.moonrakerVersion ?? "unknown";
      const klipperVersion =
        json?.info?.klipperVersion ?? "Klipper version not reported";
      const klippyState = json?.info?.klippyState
        ? ` · ${json.info.klippyState}`
        : "";
      setTestMessage({
        tone: "ok",
        text: `Moonraker ${moonrakerVersion} · ${klipperVersion}${klippyState}`,
      });
    } catch (error) {
      setTestMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to test printer connection.",
      });
    } finally {
      setTestBusy(false);
    }
  }

  const inputClass =
    "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-teal)]";

  return (
    <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[var(--color-text)] marker:hidden">
        <span>Add printer</span>
        <span className="text-xs text-[var(--color-muted)] transition-transform group-open:rotate-180">
          ▼
        </span>
      </summary>
      <form
        onSubmit={submit}
        className="border-t border-[var(--color-border)] p-4"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className={inputClass}
            placeholder="Name"
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            required
          />
          <input
            className={inputClass}
            placeholder="Model"
            value={form.model}
            onChange={(event) => update("model", event.target.value)}
            required
          />
          <select
            className={inputClass}
            value={form.type}
            onChange={(event) =>
              update("type", event.target.value as PrinterType)
            }
          >
            <option value="FDM">FDM</option>
            <option value="FGF">FGF</option>
          </select>
          <input
            className={inputClass}
            placeholder="Moonraker IP"
            value={form.ip}
            onChange={(event) => update("ip", event.target.value)}
            required
          />
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder="Port"
            value={form.port}
            onChange={(event) => update("port", event.target.value)}
            required
          />
          <input
            className={inputClass}
            placeholder="Build volume"
            value={form.build_volume}
            onChange={(event) => update("build_volume", event.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Material"
            value={form.material}
            onChange={(event) => update("material", event.target.value)}
          />
          <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
            <button
              type="button"
              disabled={testBusy || busy}
              onClick={testConnection}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] transition-all hover:border-[var(--color-teal)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {testBusy ? "Testing..." : "Test connection"}
            </button>
            <button
              disabled={busy || testBusy}
              className="rounded-lg bg-[var(--color-teal)] px-4 py-2 text-sm font-semibold text-[var(--color-bg)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Adding..." : "Add Printer"}
            </button>
          </div>
        </div>
        {testMessage && (
          <p
            className={
              testMessage.tone === "error"
                ? "mt-3 text-xs text-[var(--color-red)]"
                : "mt-3 text-xs text-[var(--color-green)]"
            }
          >
            {testMessage.text}
          </p>
        )}
        {message && (
          <p
            className={
              message.tone === "error"
                ? "mt-3 text-xs text-[var(--color-red)]"
                : "mt-3 text-xs text-[var(--color-green)]"
            }
          >
            {message.text}
          </p>
        )}
      </form>
    </details>
  );
}
