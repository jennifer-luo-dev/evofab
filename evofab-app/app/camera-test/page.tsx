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
  sense_mode?: "depth" | "rgb";
  error?: string;
}

const OVERLAY_MODES: OverlayMode[] = ["combined", "raw", "mask", "skeleton"];

export default function CameraTestPage() {
  const [metrics, setMetrics] = useState<CameraMetrics>({ status: "IDLE" });
  const [wsConnected, setWsConnected] = useState(false);
  const [streamError, setStreamError] = useState(false);

  // Controls (mirrored from server config on mount)
  const [cameraIndex, setCameraIndex] = useState(0);
  const [zMin, setZMin] = useState(0.40);
  const [zMax, setZMax] = useState(0.55);
  const [threshold, setThreshold] = useState(200);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("combined");
  const [ppm, setPpm] = useState(2800);

  const zMinDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zMaxDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ppmDebounce   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebSocket — auto-reconnect every 3 s on close
  useEffect(() => {
    let ws: WebSocket;
    let cancelled = false;

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { if (!cancelled) setWsConnected(true); };
      ws.onclose = () => {
        if (!cancelled) { setWsConnected(false); setTimeout(connect, 3000); }
      };
      ws.onerror = () => { if (!cancelled) setWsConnected(false); };
      ws.onmessage = (e) => {
        try { if (!cancelled) setMetrics(JSON.parse(e.data)); } catch {}
      };
    }

    connect();
    return () => { cancelled = true; ws?.close(); };
  }, []);

  // Mirror server config on mount
  useEffect(() => {
    fetch(`${API}/camera/config`)
      .then((r) => r.json())
      .then((cfg) => {
        setCameraIndex(cfg.camera_index ?? 0);
        setZMin(cfg.z_min ?? 0.40);
        setZMax(cfg.z_max ?? 0.55);
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
    setStreamError(false); // force <img> remount
  }

  function handleZMin(v: number) {
    setZMin(v);
    if (zMinDebounce.current) clearTimeout(zMinDebounce.current);
    zMinDebounce.current = setTimeout(() => patchConfig({ z_min: v }), 80);
  }

  function handleZMax(v: number) {
    setZMax(v);
    if (zMaxDebounce.current) clearTimeout(zMaxDebounce.current);
    zMaxDebounce.current = setTimeout(() => patchConfig({ z_max: v }), 80);
  }

  function handleThreshold(v: number) {
    setThreshold(v);
    if (threshDebounce.current) clearTimeout(threshDebounce.current);
    threshDebounce.current = setTimeout(() => patchConfig({ threshold: v }), 80);
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
    metrics.status === "TRACKING"   ? "text-teal" :
    metrics.status === "NO_TARGET"  ? "text-amber-400" :
    metrics.status === "MATH_ERROR" ? "text-red-400" :
    metrics.status === "NO_CAMERA"  ? "text-red-400" :
    metrics.status === "ERROR"      ? "text-red-400" :
    "text-muted";

  const isTracking = metrics.status === "TRACKING";

  return (
    <div className="max-w-6xl mx-auto mt-8 px-6 pb-12 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">
          Camera + Characterization Test
        </h1>
        <p className="text-sm text-muted mt-1">
          Orbbec Gemini 335Lg — depth-gated mask → skeleton → curvature, live.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">

        {/* ── Camera feed ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                Live Feed
              </span>
              <span className="text-xs font-mono text-muted">Gemini 335Lg</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Sense mode badge */}
              {metrics.sense_mode && (
                <span className={cn(
                  "text-xs font-mono px-1.5 py-0.5 rounded border",
                  metrics.sense_mode === "depth"
                    ? "text-teal border-teal/30 bg-teal/10"
                    : "text-amber-400 border-amber-400/30 bg-amber-400/10"
                )}>
                  {metrics.sense_mode}
                </span>
              )}
              {wsConnected && (
                <span className="flex items-center gap-1.5 text-xs font-mono text-teal">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse-dot" />
                  WS
                </span>
              )}
              <span className={cn("text-xs font-mono font-semibold", statusColor)}>
                {metrics.status}
              </span>
            </div>
          </div>

          {/* Video */}
          <div
            className="relative w-full bg-black rounded-lg overflow-hidden"
            style={{ aspectRatio: "16/9" }}
          >
            <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse-dot" />
              <span className="text-xs font-mono font-bold text-white">LIVE</span>
            </div>

            {!streamError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={cameraIndex}
                src={`${API}/camera/stream`}
                alt="Camera characterization feed"
                className="absolute inset-0 w-full h-full object-contain"
                onError={() => setStreamError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="text-xs font-mono text-muted uppercase tracking-widest">
                  Stream unavailable
                </span>
                <button
                  onClick={() => setStreamError(false)}
                  className="text-xs text-teal hover:underline"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Overlay mode chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted mr-1">Overlay:</span>
            {OVERLAY_MODES.map((m) => (
              <button
                key={m}
                onClick={() => handleOverlayMode(m)}
                className={cn(
                  "px-3 py-1 text-xs rounded font-medium border transition-colors",
                  overlayMode === m
                    ? "bg-teal/20 text-teal border-teal/30"
                    : "bg-surface-2 text-muted border-border hover:text-text"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Metrics */}
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted">
              Curvature Metrics
            </span>
            <div className="space-y-2 text-sm font-mono">
              <MetricRow label="Status"     value={metrics.status} valueClass={statusColor} />
              <MetricRow label="Sense"      value={metrics.sense_mode ?? "—"} />
              <MetricRow label="Curvature"  value={isTracking ? `${metrics.mean_curvature!.toFixed(2)} 1/m` : "—"} />
              <MetricRow label="Bend angle" value={isTracking ? `${metrics.bend_angle_deg!.toFixed(1)}°` : "—"} />
              <MetricRow label="Radius"     value={isTracking ? `${metrics.radius_mm!.toFixed(0)} mm` : "—"} />
            </div>
            {metrics.error && (
              <p className="text-xs text-red-400 break-words">{metrics.error}</p>
            )}
          </div>

          {/* Controls */}
          <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted">
              Controls
            </span>

            {/* Device index */}
            <div className="space-y-1.5">
              <span className="text-xs text-muted uppercase tracking-wide">
                Device Index
              </span>
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    onClick={() => handleCameraIndex(i)}
                    className={cn(
                      "flex-1 py-1.5 text-sm rounded font-medium border transition-colors",
                      cameraIndex === i
                        ? "bg-teal/20 text-teal border-teal/30"
                        : "bg-surface text-muted border-border hover:text-text"
                    )}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>

            {/* Depth window */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="uppercase tracking-wide">Depth Window</span>
                <span className="font-mono text-teal">
                  {zMin.toFixed(2)} – {zMax.toFixed(2)} m
                </span>
              </div>

              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-muted">
                  <span>Near (z_min)</span>
                  <span className="font-mono">{zMin.toFixed(2)} m</span>
                </div>
                <input
                  type="range" min={0.05} max={1.50} step={0.01}
                  value={zMin}
                  onChange={(e) => handleZMin(parseFloat(e.target.value))}
                  className="accent-teal w-full"
                />
              </label>

              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-muted">
                  <span>Far (z_max)</span>
                  <span className="font-mono">{zMax.toFixed(2)} m</span>
                </div>
                <input
                  type="range" min={0.10} max={2.00} step={0.01}
                  value={zMax}
                  onChange={(e) => handleZMax(parseFloat(e.target.value))}
                  className="accent-teal w-full"
                />
              </label>
            </div>

            {/* RGB threshold (fallback) */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted">
                <span className="uppercase tracking-wide">RGB Threshold <span className="normal-case">(fallback)</span></span>
                <span className="font-mono">{threshold}</span>
              </div>
              <input
                type="range" min={0} max={255} step={1}
                value={threshold}
                onChange={(e) => handleThreshold(parseInt(e.target.value))}
                className="accent-teal w-full"
              />
            </div>

            {/* PPM */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted">
                <span className="uppercase tracking-wide">Pixels / Meter</span>
                <span className="font-mono">{ppm}</span>
              </div>
              <input
                type="number"
                value={ppm}
                onChange={(e) => handlePpm(parseFloat(e.target.value) || 2800)}
                className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text font-mono focus:outline-none focus:ring-1 focus:ring-teal"
              />
            </div>
          </div>

          {!wsConnected && (
            <p className="text-xs text-muted">
              Server not reachable — run{" "}
              <code className="font-mono text-text">uvicorn main:app</code>{" "}
              in{" "}
              <code className="font-mono text-text">app/api/python/</code>.
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
  valueClass = "text-text",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}
