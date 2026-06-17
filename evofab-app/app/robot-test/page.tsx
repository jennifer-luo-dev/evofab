"use client";

import { useState } from "react";
import { useRobot } from "@/app/contexts/RobotContext";

type MoveStatus = "idle" | "sending" | "success" | "error";

// Default within all safety planes: east y≤0.25, south x≤0.20, table z≥0.025
const DEFAULT_TARGET = { x: 0.15, y: 0.15, z: 0.30 };

export default function RobotTestPage() {
  const robot = useRobot();
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [status, setStatus] = useState<MoveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleRun() {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("http://localhost:8000/robot/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: target.x, y: target.y, z: target.z }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage(data.message ?? "Move command sent.");
      } else {
        setStatus("error");
        setMessage(data.detail ?? "Server returned an error.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to reach server.",
      );
    }
  }

  const canRun =
    robot.connected &&
    robot.is_powered &&
    !robot.is_emergency_stopped &&
    !robot.is_protective_stopped &&
    status !== "sending";

  return (
    <div className="max-w-lg mx-auto mt-12 px-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-text">
          Robot Arm — Move Test
        </h1>
        <p className="text-sm text-muted mt-1">
          Sends a Cartesian move command to the UR7e via URscript. Robot must
          be connected, powered, and pendant in Remote Control mode.
        </p>
      </div>

      {/* Robot status summary */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-1 text-sm font-mono">
        <StatusRow label="Connected" value={robot.connected} />
        <StatusRow label="Powered" value={robot.is_powered} />
        <StatusRow label="E-stop" value={robot.is_emergency_stopped} danger />
        <StatusRow
          label="Protective stop"
          value={robot.is_protective_stopped}
          danger
        />
        <StatusRow label="Program running" value={robot.is_program_running} />
        <div className="flex justify-between">
          <span className="text-muted">Robot mode</span>
          <span className="text-muted">{robot.robot_mode ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Runtime state</span>
          <span className="text-muted">{robot.runtime_state ?? "—"}</span>
        </div>
      </div>

      {/* Target coordinate inputs */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-text">
          Target position (metres, robot base frame)
        </p>
        <div className="grid grid-cols-3 gap-3">
          {(["x", "y", "z"] as const).map((axis) => (
            <label key={axis} className="flex flex-col gap-1">
              <span className="text-xs text-muted uppercase tracking-wide">
                {axis}
              </span>
              <input
                type="number"
                step="0.01"
                value={target[axis]}
                onChange={(e) =>
                  setTarget((prev) => ({
                    ...prev,
                    [axis]: parseFloat(e.target.value) || 0,
                  }))
                }
                className="rounded border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-teal"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={!canRun}
        className="w-full rounded-lg px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-teal text-white hover:opacity-90 active:opacity-80 hover:cursor-pointer"
      >
        {status === "sending" ? "Sending…" : "Run"}
      </button>

      {/* Feedback */}
      {message && (
        <p
          className={`text-sm rounded-lg px-4 py-3 border ${
            status === "success"
              ? "border-teal/30 bg-teal/10 text-teal"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          {message}
        </p>
      )}

      {!robot.connected && (
        <p className="text-xs text-muted">
          Robot is not connected — start the FastAPI server and ensure the UR7e
          is reachable at <code>ROBOT_IP</code>.
        </p>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: boolean;
  danger?: boolean;
}) {
  const color =
    danger && value ? "text-red-400" : value ? "text-teal" : "text-muted";
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={color}>{value ? "yes" : "no"}</span>
    </div>
  );
}
