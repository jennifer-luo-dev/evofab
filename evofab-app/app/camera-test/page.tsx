"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/app/lib/utils";

const API = "http://localhost:8001";
const WS_URL = "ws://localhost:8001/ws/camera";

type OverlayMode = "combined" | "raw" | "mask" | "skeleton";

interface CameraMetrics {
  status: string;
  mean_curvature?: number;
  bend_angle_deg?: number;
  radius_mm?: number;
  error?: string;
}

const OVERLAY_MODES: OverlayMode[] = ["combined", "raw", "mask", "skeleton"];

export default function CameraTestPage() {
  const [metrics, setMetrics] = useState<CameraMetrics>({ status: "IDLE" });
  const [wsConnected, setWsConnected] = useState(false);
  const [streamError, setStreamError] = useState(false);

  const [cameraIndex, setCameraIndex] = useState(0);
  const [threshold, setThreshold] = useState(200);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("combined");
  const [ppm, setPpm] = useState(2800);

  const thresholdDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ppmDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebSocket for live metrics
  useEffect(() => {
    let ws: WebSocket;
    let cancelled = false;

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { if (!cancelled) setWsConnected(true); };
      ws.onclose = () => {
        if (!cancelled) {
          setWsConnected(false);
          setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => { if (!cancelled) setWsConnected(false); };
      ws.onmessage = (e) => {
        try { if (!cancelled) setMetrics(JSON.parse(e.data)); } catch {}
      };
    }

    connect();
    return () => { cancelled = true; ws?.close(); };
  }, []);

  // Sync initial config from server on mount
  useEffect(() => {
    fetch(`${API}/camera/config`)
      .then((r) => r.json())
      .then((cfg) => {
        setCameraIndex(cfg.camera_index ?? 0);
        setThreshold(cfg.threshold ?? 200);
        setOverlayMode(cfg.overlay_mode ?? "combined");
        setPpm(cfg.ppm ?? 2800);
      })
      .catch(() => {});
  }, []);

  const patchConfig = useCallback((patch: Record<string, unknown>) => {
    fetch(`${API}/camera/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  function handleCameraIndex(idx: number) {
    setCameraIndex(idx);
    patchConfig({ camera_index: idx });
    // Reset stream so the <img> re-requests with the new camera
    setStreamError(false);
  }

  function handleThreshold(v: number) {
    setThreshold(v);
    if (thresholdDebounce.current) clearTimeout(thresholdDebounce.current);
    thresholdDebounce.current = setTimeout(() => patchConfig({ threshold: v }), 80);
  }

  function handleOverlayMode(mode: OverlayMode) {
    setOverlayMode(mode);
    patchConfig({ overlay_mode: mode });
  }

  function handlePpm(v: number) {
    setPpm(v);
    if (ppmDebounce.current) clearTimeout(ppmDebounce.current);
    ppmDebounce.current = setTimeout(() => patchConfig({ ppm: v }), 200);
  }

  const statusColor =
    metrics.status === "TRACKING"   ? "text-[var(--color-teal)]" :
    metrics.status === "NO_TARGET"  ? "text-amber-400" :
    metrics.status === "MATH_ERROR" ? "text-red-400" :
    metrics.status === "NO_CAMERA"  ? "text-red-400" :
    metrics.status === "ERROR"      ? "text-red-400" :
    "text-[var(--color-muted)]";

  const isTracking = metrics.status === "TRACKING";

  return (
    <div className="max-w-6xl mx-auto mt-8 px-6 pb-12 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">
          Camera + Characterization Test
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Live feed with real-time PneuNet curvature analysis. Mask, skeleton,
          and metrics are computed on the server and overlaid on the stream.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* ── Camera feed ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
          {/* Feed header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
              Live Feed
            </span>
            <div className="flex items-center gap-3">
              {wsConnected && (
                <span className="flex items-center gap-1.5 text-xs font-mono text-[var(--color-teal)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-teal)] animate-pulse-dot" />
                  WS
                </span>
              )}
              <span className={cn("text-xs font-mono font-semibold", statusColor)}>
                {metrics.status}
              </span>
            </div>
          </div>

          {/* Video area */}
          <div
            className="relative w-full bg-black rounded-lg overflow-hidden"
            style={{ aspectRatio: "16/9" }}
          >
            {/* LIVE badge */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse-dot" />
              <span className="text-xs font-mono font-bold text-white">LIVE</span>
            </div>

            {!streamError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={cameraIndex} // remount when index changes
                src={`${API}/camera/stream`}
                alt="Camera characterization feed"
                className="absolute inset-0 w-full h-full object-contain"
                onError={() => setStreamError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="text-xs font-mono text-[var(--color-muted)] uppercase tracking-widest">
                  Stream unavailable
                </span>
                <button
                  onClick={() => setStreamError(false)}
                  className="text-xs text-[var(--color-teal)] hover:underline"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Overlay mode chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--color-muted)] mr-1">Overlay:</span>
            {OVERLAY_MODES.map((m) => (
              <button
                key={m}
                onClick={() => handleOverlayMode(m)}
                className={cn(
                  "px-3 py-1 text-xs rounded font-medium border transition-colors",
                  overlayMode === m
                    ? "bg-[var(--color-teal)]/20 text-[var(--color-teal)] border-[var(--color-teal)]/30"
                    : "bg-[var(--color-surface-2)] text-[var(--color-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Metrics card */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
              Curvature Metrics
            </span>

            <div className="space-y-2 text-sm font-mono">
              <MetricRow
                label="Status"
                value={metrics.status}
                valueClass={statusColor}
              />
              <MetricRow
                label="Curvature"
                value={isTracking ? `${metrics.mean_curvature!.toFixed(2)} 1/m` : "—"}
              />
              <MetricRow
                label="Bend angle"
                value={isTracking ? `${metrics.bend_angle_deg!.toFixed(1)}°` : "—"}
              />
              <MetricRow
                label="Radius"
                value={isTracking ? `${metrics.radius_mm!.toFixed(0)} mm` : "—"}
              />
            </div>

            {metrics.error && (
              <p className="text-xs text-red-400 break-words">{metrics.error}</p>
            )}
          </div>

          {/* Controls card */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
              Controls
            </span>

            {/* Camera index */}
            <div className="space-y-1.5">
              <span className="text-xs text-[var(--color-muted)] uppercase tracking-wide">
                Camera Index
              </span>
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    onClick={() => handleCameraIndex(i)}
                    className={cn(
                      "flex-1 py-1.5 text-sm rounded font-medium border transition-colors",
                      cameraIndex === i
                        ? "bg-[var(--color-teal)]/20 text-[var(--color-teal)] border-[var(--color-teal)]/30"
                        : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]"
                    )}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>

            {/* Threshold */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-[var(--color-muted)]">
                <span className="uppercase tracking-wide">Brightness Threshold</span>
                <span className="font-mono">{threshold}</span>
              </div>
              <input
                type="range"
                min={0}
                max={255}
                step={1}
                value={threshold}
                onChange={(e) => handleThreshold(parseInt(e.target.value))}
                className="accent-teal w-full"
              />
              <p className="text-xs text-[var(--color-muted)]">
                Isolates bright actuator from dark background (0–255).
              </p>
            </div>

            {/* PPM */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-[var(--color-muted)]">
                <span className="uppercase tracking-wide">Pixels per Meter</span>
                <span className="font-mono">{ppm}</span>
              </div>
              <input
                type="number"
                value={ppm}
                onChange={(e) => handlePpm(parseFloat(e.target.value) || 2800)}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-teal)]"
              />
            </div>
          </div>

          {!wsConnected && (
            <p className="text-xs text-[var(--color-muted)]">
              Server not reachable — run{" "}
              <code className="font-mono text-[var(--color-text)]">
                uvicorn main:app
              </code>{" "}
              in{" "}
              <code className="font-mono text-[var(--color-text)]">
                app/api/python/
              </code>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  valueClass = "text-[var(--color-text)]",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--color-muted)]">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}
