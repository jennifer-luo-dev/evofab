"use client";

import { useEffect, useState } from "react";

interface PrinterCameraPanelProps {
  webcamUrl: string | null;
}

export function PrinterCameraPanel({ webcamUrl }: PrinterCameraPanelProps) {
  const [state, setState] = useState<"loading" | "ready" | "error">(
    webcamUrl ? "loading" : "error",
  );

  useEffect(() => {
    if (!webcamUrl) return;
    const timeout = window.setTimeout(() => setState("error"), 8_000);
    return () => window.clearTimeout(timeout);
  }, [webcamUrl]);

  if (!webcamUrl) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Camera
        </h3>
        <div className="mt-3 flex aspect-video items-center justify-center rounded-lg bg-bg text-xs text-muted">
          No camera configured
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Camera
        </h3>
        <span className="font-mono text-xs text-teal">LAN stream</span>
      </div>
      <div className="relative mt-3 aspect-video overflow-hidden rounded-lg bg-black">
        {state !== "ready" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-xs text-muted">
            {state === "loading" ? "Connecting to camera..." : "Stream unreachable"}
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG streams need a plain browser img element. */}
        <img
          src={webcamUrl}
          alt="Printer camera stream"
          className="h-full w-full object-cover"
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
        />
      </div>
    </section>
  );
}
