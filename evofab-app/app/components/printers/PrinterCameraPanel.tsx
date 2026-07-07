"use client";

import { useState } from "react";

interface PrinterCameraPanelProps {
  webcamUrl?: string | null;
  printerIp?: string | null;
}

function normalizeCameraUrl(url?: string | null): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function fallbackCameraUrl(printerIp?: string | null): string | null {
  if (!printerIp?.trim()) return null;
  return `http://${printerIp.trim()}/webcam/?action=stream`;
}

export function PrinterCameraPanel({
  webcamUrl,
  printerIp,
}: PrinterCameraPanelProps) {
  const streamUrl = normalizeCameraUrl(webcamUrl) ?? fallbackCameraUrl(printerIp);
  const [state, setState] = useState<"loading" | "ready" | "error">(
    streamUrl ? "loading" : "error",
  );

  if (!streamUrl) {
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
        <a
          href={streamUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-teal hover:underline"
        >
          Open stream
        </a>
      </div>
      <div className="relative mt-3 aspect-video overflow-hidden rounded-lg bg-black">
        {state !== "ready" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black px-4 text-center text-xs text-muted">
            <span>
              {state === "loading"
                ? "Connecting to camera..."
                : "Stream unreachable"}
            </span>
            {state === "error" && (
              <a
                href={streamUrl}
                target="_blank"
                rel="noreferrer"
                className="text-teal hover:underline"
              >
                Open stream directly
              </a>
            )}
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG streams need a plain browser img element. */}
        <img
          src={streamUrl}
          alt="Printer camera stream"
          className="h-full w-full scale-y-[-1] object-cover"
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
        />
      </div>
    </section>
  );
}
