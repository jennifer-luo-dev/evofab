// page.tsx (actuation-test)
// Manual Arduino solenoid diagnostic page: per-channel pulse firing with
// duration control and a global abort.

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const API = "http://localhost:8001";
const CHANNELS = [1, 2, 3, 4] as const;
type Channel = (typeof CHANNELS)[number];
type ChannelStatus = "idle" | "firing" | "done" | "error";

const DEFAULT_DURATION = 500; // ms
const SWEEP_DURATION = 200;   // ms — short enough to be safe, loud enough to hear
const SWEEP_GAP_MS = 600;     // ms pause between channels during a sweep

/** Manual Arduino solenoid test page: per-channel pulse firing with a global abort. */
export default function ActuationTestPage() {
  const [durations, setDurations] = useState<Record<Channel, number>>({
    1: DEFAULT_DURATION,
    2: DEFAULT_DURATION,
    3: DEFAULT_DURATION,
    4: DEFAULT_DURATION,
  });
  const [channelStatus, setChannelStatus] = useState<
    Record<Channel, ChannelStatus>
  >({ 1: "idle", 2: "idle", 3: "idle", 4: "idle" });
  const [channelMessage, setChannelMessage] = useState<
    Record<Channel, string | null>
  >({ 1: null, 2: null, 3: null, 4: null });

  const [abortStatus, setAbortStatus] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [abortMessage, setAbortMessage] = useState<string | null>(null);

  const [arduinoConnected, setArduinoConnected] = useState<boolean | null>(
    null,
  );
  const [arduinoPort, setArduinoPort] = useState<string>("");

  const [sweeping, setSweeping] = useState(false);
  const [sweepChannel, setSweepChannel] = useState<Channel | null>(null);
  const sweepAbortRef = useRef(false);

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

  /** Fires a timed solenoid pulse on the given channel and tracks its status. */
  async function firePulse(channel: Channel, durationOverride?: number) {
    const duration_ms = durationOverride ?? durations[channel];
    setChannelStatus((s) => ({ ...s, [channel]: "firing" }));
    setChannelMessage((m) => ({ ...m, [channel]: null }));
    setAbortStatus("idle");
    setAbortMessage(null);

    try {
      const res = await fetch(`${API}/actuation/pulse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, duration_ms }),
      });
      const data = await res.json();
      if (res.ok) {
        setChannelStatus((s) => ({ ...s, [channel]: "done" }));
        setChannelMessage((m) => ({ ...m, [channel]: data.message }));
        fetchStatus();
      } else {
        setChannelStatus((s) => ({ ...s, [channel]: "error" }));
        setChannelMessage((m) => ({
          ...m,
          [channel]: data.detail ?? "Server error.",
        }));
      }
    } catch (err) {
      setChannelStatus((s) => ({ ...s, [channel]: "error" }));
      setChannelMessage((m) => ({
        ...m,
        [channel]:
          err instanceof Error ? err.message : "Failed to reach server.",
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
    setChannelStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle" });
    setChannelMessage({ 1: null, 2: null, 3: null, 4: null });

    for (const ch of CHANNELS) {
      if (sweepAbortRef.current) break;
      setSweepChannel(ch);
      await firePulse(ch, SWEEP_DURATION);
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
    setAbortStatus("sending");
    setAbortMessage(null);
    try {
      const res = await fetch(`${API}/actuation/abort`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setAbortStatus("done");
        setAbortMessage(data.message);
        setChannelStatus((s) => {
          const next = { ...s };
          for (const ch of CHANNELS) {
            if (next[ch] === "firing") next[ch] = "idle";
          }
          return next;
        });
      } else {
        setAbortStatus("error");
        setAbortMessage(data.detail ?? "Abort failed.");
      }
    } catch (err) {
      setAbortStatus("error");
      setAbortMessage(
        err instanceof Error ? err.message : "Failed to reach server.",
      );
    }
  }

  return (
    <div className="max-w-2xl mx-auto mt-12 px-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-text">
          Actuation — Solenoid Valve Test
        </h1>
        <p className="text-sm text-muted mt-1">
          Sends timed pulse commands to the Arduino Uno R3 soft-robotics
          control board over USB serial. Set a duration and fire individual
          channels, or abort all valves immediately.
        </p>
      </div>

      {/* Arduino connection status */}
      <div className="rounded-lg border border-border bg-surface p-4 text-sm font-mono space-y-1">
        <div className="flex justify-between">
          <span className="text-muted">Serial port</span>
          <span className="text-muted">{arduinoPort || "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Connected</span>
          <span
            className={
              arduinoConnected === null
                ? "text-muted"
                : arduinoConnected
                  ? "text-teal"
                  : "text-muted"
            }
          >
            {arduinoConnected === null
              ? "checking…"
              : arduinoConnected
                ? "yes"
                : "no"}
          </span>
        </div>
        {arduinoConnected === false && (
          <p className="text-xs text-muted pt-1">
            Port opens on first pulse. Set{" "}
            <code className="text-text">ARDUINO_PORT</code> env var if
            auto-detect fails.
          </p>
        )}
      </div>

      {/* Channel identification sweep */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-text">Identify Channels</p>
          <p className="text-xs text-muted mt-0.5">
            Fires CH 1→4 in sequence with a {SWEEP_DURATION} ms pulse. Listen
            for solenoid clicks to map channel numbers to your actuators.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={sweeping ? stopSweep : handleSweep}
            disabled={abortStatus === "sending"}
            className={`rounded px-4 py-2 text-sm font-semibold transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
              ${sweeping
                ? "bg-amber-500/10 border border-amber-500/40 text-amber-400 hover:bg-amber-500/20"
                : "bg-surface border border-border text-text hover:bg-teal/10"
              }`}
          >
            {sweeping ? "Stop Sweep" : "Sweep CH 1→4"}
          </button>
          {sweeping && sweepChannel !== null && (
            <span className="text-sm text-muted font-mono">
              firing CH {sweepChannel}…
            </span>
          )}
        </div>
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
            onDurationChange={(v) =>
              setDurations((d) => ({ ...d, [ch]: v }))
            }
            onFire={() => firePulse(ch)}
            disabled={sweeping}
          />
        ))}
      </div>

      {/* Abort */}
      <div className="space-y-2">
        <button
          onClick={handleAbort}
          disabled={abortStatus === "sending"}
          className="w-full rounded-lg px-4 py-3 text-sm font-semibold transition-colors
            bg-red-500/10 border border-red-500/40 text-red-400
            hover:bg-red-500/20 active:opacity-80
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {abortStatus === "sending" ? "Aborting…" : "ABORT — Close All Valves"}
        </button>
        {abortMessage && (
          <p
            className={`text-sm rounded-lg px-4 py-3 border ${
              abortStatus === "done"
                ? "border-teal/30 bg-teal/10 text-teal"
                : "border-red-500/30 bg-red-500/10 text-red-400"
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
  const isFiring = status === "firing";

  const statusColor =
    status === "firing"
      ? "text-teal"
      : status === "done"
        ? "text-teal"
        : status === "error"
          ? "text-red-400"
          : "text-muted";

  const statusLabel =
    status === "firing"
      ? "firing…"
      : status === "done"
        ? "done"
        : status === "error"
          ? "error"
          : "idle";

  return (
    <div
      className={`rounded-lg border bg-surface p-4 space-y-3 transition-colors ${
        highlighted ? "border-teal/60 ring-1 ring-teal/30" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">CH {channel}</span>
        <span className={`text-xs font-mono ${statusColor}`}>
          {statusLabel}
          {status === "firing" && (
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
        {isFiring ? "Firing…" : "Fire"}
      </button>

      {message && (
        <p
          className={`text-xs rounded px-2 py-1.5 border ${
            status === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-teal/30 bg-teal/10 text-teal"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
