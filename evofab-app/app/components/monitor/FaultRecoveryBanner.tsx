"use client";

import { useState } from "react";

export function FaultRecoveryBanner({
  printerId,
  jobId,
  onRecovered,
}: {
  printerId: string;
  jobId: string;
  onRecovered: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function recover(action: "restart" | "firmware-restart") {
    setBusy(true);
    await fetch(`/api/printers/${printerId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, jobId }),
    });
    setBusy(false);
    setTimeout(onRecovered, 200);
  }
  return (
    <div className="rounded-2xl border border-red/40 bg-gradient-to-r from-red/15 via-red/5 to-surface p-5 animate-fade-up shadow-[0_0_40px_rgba(244,63,94,.08)]">
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-4">
          <span className="w-11 h-11 rounded-xl bg-red/15 text-red grid place-items-center text-xl">
            !
          </span>
          <div>
            <p className="font-semibold text-red">Klipper reports: SHUTDOWN</p>
            <p className="text-xs text-muted mt-1">
              Mock MCU lost communication. Inspect the cause before resetting
              hardware.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => recover("restart")}
            className="demo-button"
          >
            Host restart
          </button>
          <button
            disabled={busy}
            onClick={() => recover("firmware-restart")}
            className="demo-button bg-red text-white border-red"
          >
            Firmware restart
          </button>
        </div>
      </div>
    </div>
  );
}
