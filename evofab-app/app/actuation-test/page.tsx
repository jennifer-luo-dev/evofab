"use client";

import { useState, useEffect, useCallback } from "react";

const API = "http://localhost:8001";
const CHANNELS = [1, 2, 3, 4] as const;
type Channel = (typeof CHANNELS)[number];
type ChannelStatus = "idle" | "firing" | "done" | "error";

const DEFAULT_DURATION = 500; // ms

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

  async function firePulse(channel: Channel) {
    setChannelStatus((s) => ({ ...s, [channel]: "firing" }));
    setChannelMessage((m) => ({ ...m, [channel]: null }));
    setAbortStatus("idle");
    setAbortMessage(null);

    try {
      const res = await fetch(`${API}/actuation/pulse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, duration_ms: durations[channel] }),
      });
      const data = await res.json();
      if (res.ok) {
        setChannelStatus((s) => ({ ...s, [channel]: "done" }));
        setChannelMessage((m) => ({ ...m, [channel]: data.message }));
        // Refresh connection state (port opens on first pulse)
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

  async function handleAbort() {
    setAbortStatus("sending");
    setAbortMessage(null);
    try {
      const res = await fetch(`${API}/actuation/abort`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setAbortStatus("done");
        setAbortMessage(data.message);
        // Mark all firing channels as interrupted
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
            <code className="text-text">ARDUINO_PORT</code> env var if the
            device is not at <code className="text-text">/dev/ttyACM0</code>.
          </p>
        )}
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
            onDurationChange={(v) =>
              setDurations((d) => ({ ...d, [ch]: v }))
            }
            onFire={() => firePulse(ch)}
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

function ChannelCard({
  channel,
  duration,
  status,
  message,
  onDurationChange,
  onFire,
}: {
  channel: Channel;
  duration: number;
  status: ChannelStatus;
  message: string | null;
  onDurationChange: (v: number) => void;
  onFire: () => void;
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
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
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
          className="accent-teal w-full"
        />
      </label>

      <button
        onClick={onFire}
        disabled={isFiring}
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
