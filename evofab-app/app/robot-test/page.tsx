"use client";

import { useState, useEffect, useRef } from "react";
import { useRobot } from "@/app/contexts/RobotContext";

type ActionStatus = "idle" | "sending" | "success" | "error";

// Default within all safety planes: east y≤0.25, south x≤0.20, table z≥0.025
const DEFAULT_TARGET = { x: 0.15, y: 0.15, z: 0.30 };

const JOG_STEPS = [
  { label: "1 mm", value: 0.001 },
  { label: "5 mm", value: 0.005 },
  { label: "10 mm", value: 0.01 },
  { label: "50 mm", value: 0.05 },
];

export default function RobotTestPage() {
  const robot = useRobot();
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [jogStep, setJogStep] = useState(0.01);
  const initialized = useRef(false);

  // Seed target inputs from actual robot position on first connect.
  useEffect(() => {
    if (robot.tcp_pose && !initialized.current) {
      setTarget({
        x: robot.tcp_pose[0],
        y: robot.tcp_pose[1],
        z: robot.tcp_pose[2],
      });
      initialized.current = true;
    }
  }, [robot.tcp_pose]);

  async function sendMove(coords: typeof target) {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("http://localhost:8001/robot/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: coords.x, y: coords.y, z: coords.z }),
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

  function handleRun() {
    sendMove(target);
  }

  function handleJog(axis: "x" | "y" | "z", direction: 1 | -1) {
    // Always increment from the robot's actual current TCP, not the UI target,
    // so a 10 mm jog moves exactly 10 mm regardless of where the target inputs say.
    const base = robot.tcp_pose
      ? { x: robot.tcp_pose[0], y: robot.tcp_pose[1], z: robot.tcp_pose[2] }
      : target;
    const newTarget = {
      ...base,
      [axis]: parseFloat((base[axis] + direction * jogStep).toFixed(4)),
    };
    setTarget(newTarget);
    sendMove(newTarget);
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
        {robot.tcp_pose && (
          <div className="flex justify-between pt-1 border-t border-border mt-1">
            <span className="text-muted">TCP (actual)</span>
            <span className="text-muted tabular-nums">
              {robot.tcp_pose[0].toFixed(3)},{" "}
              {robot.tcp_pose[1].toFixed(3)},{" "}
              {robot.tcp_pose[2].toFixed(3)} m
            </span>
          </div>
        )}
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

      {/* Jog controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text">Jog</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Step:</span>
            <select
              value={jogStep}
              onChange={(e) => setJogStep(parseFloat(e.target.value))}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-teal"
            >
              {JOG_STEPS.map(({ label, value }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(["x", "y", "z"] as const).map((axis) => (
            <div key={axis} className="flex flex-col items-center gap-1">
              <span className="text-xs text-muted uppercase tracking-wide">
                {axis}
              </span>
              <div className="flex gap-1 w-full">
                <button
                  onClick={() => handleJog(axis, -1)}
                  disabled={!canRun}
                  className="flex-1 rounded border border-border bg-surface px-2 py-2 text-sm font-bold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <button
                  onClick={() => handleJog(axis, 1)}
                  disabled={!canRun}
                  className="flex-1 rounded border border-border bg-surface px-2 py-2 text-sm font-bold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          Each press updates the target and immediately sends a move command.
        </p>
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

      <hr className="border-border" />

      <GripperControl canRun={canRun} />
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

const DEFAULT_GRIPPER = { position: 128, speed: 128, force: 50 };

function GripperControl({ canRun }: { canRun: boolean }) {
  const [params, setParams] = useState(DEFAULT_GRIPPER);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleRunGripper() {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("http://localhost:8001/robot/gripper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage(data.message ?? "Gripper cycle complete.");
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

  const PARAM_LABELS: Record<keyof typeof DEFAULT_GRIPPER, string> = {
    position: "Position",
    speed: "Speed",
    force: "Force",
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text">Robotiq Gripper</h2>
        <p className="text-sm text-muted mt-1">
          Runs <code>gripper_basic.urp</code> — activates, opens, then closes
          the gripper. Parameters are written to integer input registers 0–2
          before the program starts; read them inside the URP with{" "}
          <code>get_input_integer_register(n)</code>.
        </p>
      </div>

      <div className="space-y-3">
        {(["position", "speed", "force"] as const).map((param) => (
          <label key={param} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-muted">
              <span className="uppercase tracking-wide">
                {PARAM_LABELS[param]}
              </span>
              <span>{params[param]} / 255</span>
            </div>
            <input
              type="range"
              min={0}
              max={255}
              value={params[param]}
              onChange={(e) =>
                setParams((prev) => ({
                  ...prev,
                  [param]: parseInt(e.target.value),
                }))
              }
              className="accent-teal w-full"
            />
          </label>
        ))}
      </div>

      <button
        onClick={handleRunGripper}
        disabled={!canRun || status === "sending"}
        className="w-full rounded-lg px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-teal text-white hover:opacity-90 active:opacity-80 hover:cursor-pointer"
      >
        {status === "sending" ? "Running…" : "Run Gripper Cycle"}
      </button>

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
    </div>
  );
}
