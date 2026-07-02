"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/app/lib/utils";

const API = "http://localhost:8001";

interface CalibState {
  active: boolean;
  grid_cols: number;
  grid_rows: number;
  square_mm: number;
  frame_count: number;
  last_found: boolean;
  calibrated: boolean;
  result: { rms: number; ppm: number; applied: boolean } | null;
}

const RECOMMENDED_FRAMES = 15;

export default function CalibrationPage() {
  const [state, setState] = useState<CalibState>({
    active: false,
    grid_cols: 9,
    grid_rows: 6,
    square_mm: 25.0,
    frame_count: 0,
    last_found: false,
    calibrated: false,
    result: null,
  });

  const [cols, setCols] = useState(9);
  const [rows, setRows] = useState(6);
  const [squareMm, setSquareMm] = useState(25.0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const r = await fetch(`${API}/camera/calibrate`);
      if (r.ok) setState(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchState();
    pollRef.current = setInterval(fetchState, 600);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchState]);

  async function post(path: string, body?: object) {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`${API}${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? "Request failed");
      await fetchState();
      return data;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive() {
    await post("/camera/calibrate/config", { active: !state.active });
    setStreamKey((k) => k + 1);
  }

  async function handleApplyConfig() {
    await post("/camera/calibrate/config", {
      grid_cols: cols,
      grid_rows: rows,
      square_mm: squareMm,
    });
  }

  async function handleCapture() {
    await post("/camera/calibrate/capture");
  }

  async function handleRun() {
    await post("/camera/calibrate/run");
  }

  async function handleApply() {
    await post("/camera/calibrate/apply");
  }

  async function handleClear() {
    if (!confirm("Clear all captured frames and reset calibration?")) return;
    await post("/camera/calibrate/clear");
    setStreamKey((k) => k + 1);
  }

  const progress = Math.min(state.frame_count / RECOMMENDED_FRAMES, 1);
  const canRun = state.frame_count >= 8 && !busy;
  const canCapture = state.active && state.last_found && !busy;
  const rmsGood = state.result && state.result.rms < 0.5;
  const rmsOk   = state.result && state.result.rms < 1.0;

  return (
    <div className="max-w-5xl mx-auto mt-8 px-6 pb-12 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Camera Calibration</h1>
        <p className="text-sm text-muted mt-1">
          Chessboard intrinsic calibration — corrects lens distortion and estimates pixels/meter.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

        {/* ── Live feed ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted">
              Live Feed
            </span>
            <div className="flex items-center gap-3">
              {state.active && (
                <span className={cn(
                  "text-xs font-mono px-1.5 py-0.5 rounded border",
                  state.last_found
                    ? "text-teal border-teal/30 bg-teal/10"
                    : "text-amber-400 border-amber-400/30 bg-amber-400/10"
                )}>
                  {state.last_found ? "corners found" : "no corners"}
                </span>
              )}
              {state.calibrated && (
                <span className="text-xs font-mono text-teal">✓ calibrated</span>
              )}
            </div>
          </div>

          <div
            className="relative w-full bg-black rounded-lg overflow-hidden"
            style={{ aspectRatio: "16/9" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={streamKey}
              src={`${API}/camera/stream`}
              alt="Camera calibration feed"
              className="absolute inset-0 w-full h-full object-contain"
            />
            {state.active && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse-dot" />
                <span className="text-xs font-mono font-bold text-white">CALIB MODE</span>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-1.5 text-xs text-muted">
            <p className="font-semibold text-text uppercase tracking-wide text-[10px]">Instructions</p>
            <ol className="list-decimal list-inside space-y-1 leading-relaxed">
              <li>Print the checkerboard on A4 / Letter. Count <strong className="text-text">inner corners</strong> (not squares).</li>
              <li>Enter the grid size and physical square size, then click <strong className="text-text">Start</strong>.</li>
              <li>Hold the board flat in front of the camera. When green dots appear on the corners, click <strong className="text-text">Capture</strong>.</li>
              <li>Move the board to different angles and positions. Aim for {RECOMMENDED_FRAMES}+ frames with good coverage.</li>
              <li>Click <strong className="text-text">Run Calibration</strong>, verify the RMS error, then click <strong className="text-text">Apply</strong>.</li>
            </ol>
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Step 1 — Configure */}
          <StepCard step={1} title="Configure Grid">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Inner corners — columns × rows</span>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={2} max={20}
                  value={cols}
                  onChange={(e) => setCols(Math.max(2, parseInt(e.target.value) || 9))}
                  className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text font-mono focus:outline-none focus:ring-1 focus:ring-teal"
                />
                <span className="text-muted">×</span>
                <input
                  type="number" min={2} max={20}
                  value={rows}
                  onChange={(e) => setRows(Math.max(2, parseInt(e.target.value) || 6))}
                  className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text font-mono focus:outline-none focus:ring-1 focus:ring-teal"
                />
              </div>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Square size (mm)</span>
              <input
                type="number" min={1} step={0.5}
                value={squareMm}
                onChange={(e) => setSquareMm(parseFloat(e.target.value) || 25)}
                className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text font-mono focus:outline-none focus:ring-1 focus:ring-teal"
              />
            </label>

            <div className="flex gap-2">
              <button
                onClick={handleApplyConfig}
                disabled={busy}
                className="flex-1 py-1.5 text-sm rounded border border-border text-muted hover:text-text transition-colors disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={handleToggleActive}
                disabled={busy}
                className={cn(
                  "flex-1 py-1.5 text-sm rounded border font-medium transition-colors disabled:opacity-40",
                  state.active
                    ? "bg-amber-400/10 text-amber-400 border-amber-400/30 hover:bg-amber-400/20"
                    : "bg-teal/10 text-teal border-teal/30 hover:bg-teal/20"
                )}
              >
                {state.active ? "Stop" : "Start"}
              </button>
            </div>
          </StepCard>

          {/* Step 2 — Capture */}
          <StepCard step={2} title="Capture Frames">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted">
                <span>Frames captured</span>
                <span className="font-mono text-text">
                  {state.frame_count} / {RECOMMENDED_FRAMES}
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal transition-all duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                {Array.from({ length: RECOMMENDED_FRAMES }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-3 h-3 rounded-sm",
                      i < state.frame_count ? "bg-teal" : "bg-surface-2"
                    )}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={handleCapture}
              disabled={!canCapture}
              className={cn(
                "w-full py-2 text-sm rounded border font-medium transition-colors",
                canCapture
                  ? "bg-teal/10 text-teal border-teal/30 hover:bg-teal/20"
                  : "text-muted border-border opacity-40 cursor-not-allowed"
              )}
            >
              {state.active
                ? state.last_found
                  ? "Capture Frame ↩"
                  : "Waiting for corners…"
                : "Enable calibration mode first"}
            </button>
          </StepCard>

          {/* Step 3 — Run & Apply */}
          <StepCard step={3} title="Calibrate">
            <button
              onClick={handleRun}
              disabled={!canRun}
              className={cn(
                "w-full py-2 text-sm rounded border font-medium transition-colors",
                canRun
                  ? "bg-surface-2 text-text border-border hover:border-teal hover:text-teal"
                  : "text-muted border-border opacity-40 cursor-not-allowed"
              )}
            >
              {state.frame_count < 8
                ? `Need ${8 - state.frame_count} more frame${8 - state.frame_count === 1 ? "" : "s"}`
                : busy ? "Running…" : "Run Calibration"}
            </button>

            {state.result && (
              <div className="space-y-2 text-sm font-mono">
                <div className="flex justify-between">
                  <span className="text-muted">RMS error</span>
                  <span className={cn(
                    "font-semibold",
                    rmsGood ? "text-teal" : rmsOk ? "text-amber-400" : "text-red-400"
                  )}>
                    {state.result.rms} px
                    {rmsGood ? " ✓" : rmsOk ? " !" : " ✗"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Est. ppm</span>
                  <span className="text-text">{state.result.ppm.toFixed(0)}</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {rmsGood
                    ? "Excellent. Apply to enable undistortion and update pixels/meter."
                    : rmsOk
                    ? "Acceptable. More frames at varied angles will improve it."
                    : "High error — capture more frames with the board flat and well-lit, then re-run."}
                </p>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleApply}
                    disabled={busy || state.result.applied}
                    className={cn(
                      "flex-1 py-1.5 text-sm rounded border font-medium transition-colors",
                      state.result.applied
                        ? "text-teal border-teal/30 bg-teal/10 opacity-60"
                        : "bg-teal/10 text-teal border-teal/30 hover:bg-teal/20 disabled:opacity-40"
                    )}
                  >
                    {state.result.applied ? "Applied ✓" : "Apply"}
                  </button>
                  <button
                    onClick={handleClear}
                    disabled={busy}
                    className="flex-1 py-1.5 text-sm rounded border border-border text-muted hover:text-red-400 hover:border-red-400/30 transition-colors disabled:opacity-40"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}

            {!state.result && state.frame_count >= 8 && (
              <button
                onClick={handleClear}
                disabled={busy}
                className="w-full py-1.5 text-sm rounded border border-border text-muted hover:text-red-400 hover:border-red-400/30 transition-colors disabled:opacity-40"
              >
                Clear All
              </button>
            )}
          </StepCard>

          {error && (
            <p className="text-xs text-red-400 break-words px-1">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal/15 text-teal text-xs font-bold">
          {step}
        </span>
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}
