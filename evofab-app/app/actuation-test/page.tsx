// page.tsx (actuation-test)
// Manual Arduino solenoid diagnostic page: per-channel pulse firing with
// duration control and a global abort. Also shows a live camera preview
// (Orbbec Gemini 335L, RGB via OpenCV/AVFoundation) and, on request, an
// actuation-moment photo synced to the Arduino's own STATUS:BUSY:CH<n> line —
// see camera_manager.py / _serial_reader in main.py. Nothing is persisted to
// disk; this is a live/latency-check view, not a stored result.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const API = 'http://localhost:8001';
const CHANNELS = [1, 2, 3, 4] as const;
type Channel = (typeof CHANNELS)[number];
type ChannelStatus = 'idle' | 'firing' | 'done' | 'error';

const DEFAULT_DURATION = 600; // ms — confirmed working duration for inflation (2026-07-06)
const SWEEP_DURATION = 200; // ms — short enough to be safe, loud enough to hear
const SWEEP_GAP_MS = 600; // ms pause between channels during a sweep

const SNAPSHOT_POLL_MS = 200; // live preview refresh rate
const CAMERA_STATUS_POLL_MS = 2000;
const CAPTURE_POLL_MS = 150; // how often to check for the pulse-synced capture
const CAPTURE_POLL_TIMEOUT_MS = 2500; // a bit over the backend's 2 s capture timeout

interface LastCapture {
  channel: number;
  synced: boolean;
  latency_ms: number;
  timestamp: number; // seconds, epoch — for comparing against a pre-fire mark
  image_url: string;
  analysis_status: 'TRACKING' | 'NO_TARGET' | 'MATH_ERROR' | 'ERROR';
  mean_curvature: number | null; // 1/m
  bend_angle_deg: number | null;
  radius_mm: number | null;
}

/** Manual Arduino solenoid test page: per-channel pulse firing with a global abort. */
export default function ActuationTestPage() {
  const [durations, setDurations] = useState<Record<Channel, number>>({
    1: DEFAULT_DURATION,
    2: DEFAULT_DURATION,
    3: DEFAULT_DURATION,
    4: DEFAULT_DURATION,
  });
  const [channelStatus, setChannelStatus] = useState<Record<Channel, ChannelStatus>>({
    1: 'idle',
    2: 'idle',
    3: 'idle',
    4: 'idle',
  });
  const [channelMessage, setChannelMessage] = useState<Record<Channel, string | null>>({
    1: null,
    2: null,
    3: null,
    4: null,
  });

  const [abortStatus, setAbortStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [abortMessage, setAbortMessage] = useState<string | null>(null);

  const [arduinoConnected, setArduinoConnected] = useState<boolean | null>(null);
  const [arduinoPort, setArduinoPort] = useState<string>('');

  const [sweeping, setSweeping] = useState(false);
  const [sweepChannel, setSweepChannel] = useState<Channel | null>(null);
  const sweepAbortRef = useRef(false);

  // Bumped on every fire/abort for a channel so a stale completion timer
  // (from a pulse that was superseded or aborted) can no-op instead of
  // overwriting newer state.
  const fireTokenRef = useRef<Record<Channel, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });

  const [cameraConnected, setCameraConnected] = useState<boolean | null>(null);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [lastCapture, setLastCapture] = useState<LastCapture | null>(null);
  const [captureWaiting, setCaptureWaiting] = useState(false);

  /** Polls the Arduino connection status (connected, serial port). */
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/actuation/status`);
      if (res.ok) {
        const data = await res.json();
        setArduinoConnected(data.connected);
        setArduinoPort(data.port);
      }
    } catch {
      setArduinoConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  /** Polls camera connection status separately from the (fast) live preview. */
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${API}/camera/status`);
        if (!cancelled) setCameraConnected(res.ok ? (await res.json()).connected : false);
      } catch {
        if (!cancelled) setCameraConnected(false);
      }
    }
    poll();
    const id = setInterval(poll, CAMERA_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Live preview: bump a tick to cache-bust the snapshot <img> src on an interval.
  useEffect(() => {
    const id = setInterval(() => setSnapshotTick((t) => t + 1), SNAPSHOT_POLL_MS);
    return () => clearInterval(id);
  }, []);

  /**
   * Polls /camera/last-capture until a capture newer than sinceTimestamp
   * (a pre-fire Date.now()/1000 mark) shows up, or CAPTURE_POLL_TIMEOUT_MS
   * elapses (camera disconnected, or the backend's own timeout produced no
   * frame at all because the camera wasn't connected when it fired).
   */
  async function pollForCapture(sinceTimestamp: number) {
    setCaptureWaiting(true);
    const deadline = Date.now() + CAPTURE_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${API}/camera/last-capture`);
        if (res.ok) {
          const data: LastCapture = await res.json();
          if (data.timestamp > sinceTimestamp) {
            setLastCapture(data);
            setCaptureWaiting(false);
            return;
          }
        }
      } catch {
        // keep polling — transient fetch failure
      }
      await new Promise((r) => setTimeout(r, CAPTURE_POLL_MS));
    }
    setCaptureWaiting(false);
  }

  /**
   * Fires a timed solenoid pulse on the given channel and tracks its status.
   * When capture is true (default: captureEnabled), also kicks off polling
   * for the actuation-synced camera capture — see pollForCapture.
   */
  async function firePulse(
    channel: Channel,
    opts: { durationOverride?: number; capture?: boolean } = {}
  ) {
    const duration_ms = opts.durationOverride ?? durations[channel];
    const capture = opts.capture ?? captureEnabled;
    const token = ++fireTokenRef.current[channel];
    const preFireTs = Date.now() / 1000;

    setChannelStatus((s) => ({ ...s, [channel]: 'firing' }));
    setChannelMessage((m) => ({ ...m, [channel]: null }));
    setAbortStatus('idle');
    setAbortMessage(null);

    try {
      const res = await fetch(`${API}/actuation/pulse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, duration_ms, capture }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChannelStatus((s) => ({ ...s, [channel]: 'error' }));
        setChannelMessage((m) => ({
          ...m,
          [channel]: data.detail ?? 'Server error.',
        }));
        return;
      }

      if (data.capture_pending) {
        pollForCapture(preFireTs); // fire-and-forget — don't block the completion timer below
      }

      // The server only confirms the write succeeded — the Arduino opens the
      // valve immediately and finishes on its own timer, so track completion
      // client-side with the same duration rather than waiting on a slow
      // round trip for STATUS:DONE.
      await new Promise((r) => setTimeout(r, duration_ms));
      if (fireTokenRef.current[channel] !== token) return; // superseded by abort/refire

      setChannelStatus((s) => ({ ...s, [channel]: 'done' }));
      setChannelMessage((m) => ({
        ...m,
        [channel]: `Channel ${channel} pulse complete (${duration_ms} ms).`,
      }));
      fetchStatus();
    } catch (err) {
      setChannelStatus((s) => ({ ...s, [channel]: 'error' }));
      setChannelMessage((m) => ({
        ...m,
        [channel]: err instanceof Error ? err.message : 'Failed to reach server.',
      }));
    }
  }

  /**
   * Fires each channel in sequence with a short SWEEP_DURATION pulse so you
   * can listen for which solenoid clicks and map channel numbers to actuators.
   * Stops early if sweepAbortRef is set.
   */
  async function handleSweep() {
    setSweeping(true);
    sweepAbortRef.current = false;
    setChannelStatus({ 1: 'idle', 2: 'idle', 3: 'idle', 4: 'idle' });
    setChannelMessage({ 1: null, 2: null, 3: null, 4: null });

    for (const ch of CHANNELS) {
      if (sweepAbortRef.current) break;
      setSweepChannel(ch);
      await firePulse(ch, { durationOverride: SWEEP_DURATION, capture: false });
      // Brief pause so it's easy to hear each click as a distinct event.
      await new Promise((r) => setTimeout(r, SWEEP_GAP_MS));
    }

    setSweeping(false);
    setSweepChannel(null);
  }

  function stopSweep() {
    sweepAbortRef.current = true;
  }

  /** Sends an abort command to close all solenoid valves and resets any firing channels to idle. */
  async function handleAbort() {
    sweepAbortRef.current = true;
    setSweeping(false);
    setSweepChannel(null);
    for (const ch of CHANNELS) fireTokenRef.current[ch]++; // invalidate pending pulse timers
    setAbortStatus('sending');
    setAbortMessage(null);
    try {
      const res = await fetch(`${API}/actuation/abort`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setAbortStatus('done');
        setAbortMessage(data.message);
        setChannelStatus((s) => {
          const next = { ...s };
          for (const ch of CHANNELS) {
            if (next[ch] === 'firing') next[ch] = 'idle';
          }
          return next;
        });
      } else {
        setAbortStatus('error');
        setAbortMessage(data.detail ?? 'Abort failed.');
      }
    } catch (err) {
      setAbortStatus('error');
      setAbortMessage(err instanceof Error ? err.message : 'Failed to reach server.');
    }
  }

  return (
    <div className="max-w-2xl mx-auto mt-12 px-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-text">Actuation — Solenoid Valve Test</h1>
        <p className="text-sm text-muted mt-1">
          Sends timed pulse commands to the Arduino Uno R3 soft-robotics control board over USB
          serial. Set a duration and fire individual channels, or abort all valves immediately.
        </p>
      </div>

      {/* Camera — live preview + actuation-synced capture */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text">Camera</span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={captureEnabled}
                onChange={(e) => setCaptureEnabled(e.target.checked)}
                className="accent-teal"
              />
              Capture photo on fire
            </label>
            <span className={`text-xs font-mono ${cameraConnected ? 'text-teal' : 'text-muted'}`}>
              {cameraConnected === null ? 'checking…' : cameraConnected ? 'connected' : 'offline'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div
            className="relative w-full bg-black rounded-lg overflow-hidden"
            style={{ aspectRatio: '16/9' }}
          >
            {cameraConnected ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API}/camera/snapshot?t=${snapshotTick}`}
                alt="Live camera preview"
                className="absolute inset-0 w-full h-full object-cover transform -scale-y-100 -scale-x-100"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-mono text-muted uppercase tracking-widest">
                  {cameraConnected === null ? 'Checking…' : 'Standby'}
                </span>
              </div>
            )}
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-dot" />
              <span className="text-[10px] font-mono font-bold text-white">LIVE</span>
            </div>
          </div>

          <div
            className="relative w-full bg-black rounded-lg overflow-hidden"
            style={{ aspectRatio: '16/9' }}
          >
            {lastCapture ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API}${lastCapture.image_url}?t=${lastCapture.timestamp}`}
                  alt={`Actuation capture: CH${lastCapture.channel}`}
                  className="absolute inset-0 w-full h-full object-cover transform -scale-y-100 -scale-x-100"
                />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      lastCapture.synced ? 'bg-teal/20 text-teal' : 'bg-amber-400/20 text-amber-400'
                    }`}
                  >
                    CH{lastCapture.channel} · {lastCapture.synced ? 'synced' : 'timeout'} ·{' '}
                    {lastCapture.latency_ms.toFixed(0)} ms
                  </span>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-mono text-muted uppercase tracking-widest">
                  {captureWaiting ? 'Capturing…' : 'No capture yet'}
                </span>
              </div>
            )}
          </div>
        </div>

        {lastCapture && (
          <div className="flex items-center justify-between text-xs font-mono pt-1">
            <span
              className={
                lastCapture.analysis_status === 'TRACKING' ? 'text-teal' : 'text-amber-400'
              }
            >
              {lastCapture.analysis_status}
            </span>
            {lastCapture.analysis_status === 'TRACKING' && (
              <span className="text-muted">
                K <span className="text-text">{lastCapture.mean_curvature?.toFixed(2)}</span> 1/m
                {'  ·  '}
                Angle <span className="text-text">{lastCapture.bend_angle_deg?.toFixed(1)}</span>°
                {'  ·  '}
                R <span className="text-text">{lastCapture.radius_mm?.toFixed(0)}</span> mm
              </span>
            )}
          </div>
        )}
      </div>

      {/* Arduino connection status */}
      <div className="rounded-lg border border-border bg-surface p-4 text-sm font-mono space-y-1">
        <div className="flex justify-between">
          <span className="text-muted">Serial port</span>
          <span className="text-muted">{arduinoPort || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Connected</span>
          <span
            className={
              arduinoConnected === null
                ? 'text-muted'
                : arduinoConnected
                  ? 'text-teal'
                  : 'text-muted'
            }
          >
            {arduinoConnected === null ? 'checking…' : arduinoConnected ? 'yes' : 'no'}
          </span>
        </div>
        {arduinoConnected === false && (
          <p className="text-xs text-muted pt-1">
            Port opens on first pulse. Set <code className="text-text">ARDUINO_PORT</code> env var
            if auto-detect fails.
          </p>
        )}
      </div>

      {/* Channel identification sweep */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-text">Identify Channels</p>
          <p className="text-xs text-muted mt-0.5">
            Fires CH 1→4 in sequence with a {SWEEP_DURATION} ms pulse. Listen for solenoid clicks to
            map channel numbers to your actuators.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={sweeping ? stopSweep : handleSweep}
            disabled={abortStatus === 'sending'}
            className={`rounded px-4 py-2 text-sm font-semibold transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
              ${
                sweeping
                  ? 'bg-amber-500/10 border border-amber-500/40 text-amber-400 hover:bg-amber-500/20'
                  : 'bg-surface border border-border text-text hover:bg-teal/10'
              }`}
          >
            {sweeping ? 'Stop Sweep' : 'Sweep CH 1→4'}
          </button>
          {sweeping && sweepChannel !== null && (
            <span className="text-sm text-muted font-mono">firing CH {sweepChannel}…</span>
          )}
        </div>
      </div>

      {/* Pressure reminder — a valve click with no inflation is identical
          whether the air supply is off or a valve/tube is actually faulty.
          Checking this first saves re-debugging the electrical chain. */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-400">
        Before firing: confirm the manual regulator and the electronic (ITV) regulator are both on
        and set above 0 PSI. A valve can click correctly with zero air pressure — no inflation in
        that case is not a wiring or board fault.
      </div>

      {/* Channel cards */}
      <div className="grid grid-cols-2 gap-4">
        {CHANNELS.map((ch) => (
          <ChannelCard
            key={ch}
            channel={ch}
            duration={durations[ch]}
            status={channelStatus[ch]}
            message={channelMessage[ch]}
            highlighted={sweeping && sweepChannel === ch}
            onDurationChange={(v) => setDurations((d) => ({ ...d, [ch]: v }))}
            onFire={() => firePulse(ch)}
            disabled={sweeping}
          />
        ))}
      </div>

      {/* Abort */}
      <div className="space-y-2">
        <button
          onClick={handleAbort}
          disabled={abortStatus === 'sending'}
          className="w-full rounded-lg px-4 py-3 text-sm font-semibold transition-colors
            bg-red-500/10 border border-red-500/40 text-red-400
            hover:bg-red-500/20 active:opacity-80
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {abortStatus === 'sending' ? 'Aborting…' : 'ABORT — Close All Valves'}
        </button>
        {abortMessage && (
          <p
            className={`text-sm rounded-lg px-4 py-3 border ${
              abortStatus === 'done'
                ? 'border-teal/30 bg-teal/10 text-teal'
                : 'border-red-500/30 bg-red-500/10 text-red-400'
            }`}
          >
            {abortMessage}
          </p>
        )}
      </div>
    </div>
  );
}

/** Single solenoid channel card with a duration slider and fire button. */
function ChannelCard({
  channel,
  duration,
  status,
  message,
  highlighted,
  onDurationChange,
  onFire,
  disabled,
}: {
  channel: Channel;
  duration: number;
  status: ChannelStatus;
  message: string | null;
  highlighted: boolean;
  onDurationChange: (v: number) => void;
  onFire: () => void;
  disabled: boolean;
}) {
  const isFiring = status === 'firing';

  const statusColor =
    status === 'firing'
      ? 'text-teal'
      : status === 'done'
        ? 'text-teal'
        : status === 'error'
          ? 'text-red-400'
          : 'text-muted';

  const statusLabel =
    status === 'firing'
      ? 'firing…'
      : status === 'done'
        ? 'done'
        : status === 'error'
          ? 'error'
          : 'idle';

  return (
    <div
      className={`rounded-lg border bg-surface p-4 space-y-3 transition-colors ${
        highlighted ? 'border-teal/60 ring-1 ring-teal/30' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">CH {channel}</span>
        <span className={`text-xs font-mono ${statusColor}`}>
          {statusLabel}
          {status === 'firing' && (
            <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-teal animate-pulse-dot" />
          )}
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-muted">
          <span className="uppercase tracking-wide">Duration</span>
          <span>{duration} ms</span>
        </div>
        <input
          type="range"
          min={50}
          max={5000}
          step={50}
          value={duration}
          onChange={(e) => onDurationChange(parseInt(e.target.value))}
          disabled={disabled}
          className="accent-teal w-full disabled:opacity-40"
        />
      </label>

      <button
        onClick={onFire}
        disabled={isFiring || disabled}
        className="w-full rounded px-3 py-2 text-sm font-semibold transition-colors
          bg-teal text-white hover:opacity-90 active:opacity-80
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isFiring ? 'Firing…' : 'Fire'}
      </button>

      {message && (
        <p
          className={`text-xs rounded px-2 py-1.5 border ${
            status === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-400'
              : 'border-teal/30 bg-teal/10 text-teal'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
