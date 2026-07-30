// page.tsx (robot-test)
// Manual UR7e diagnostic page: jog controls, a waypoint queue, and a
// Robotiq gripper test panel, all driving the robot via direct FastAPI calls.

"use client";

import { useState, useEffect, useRef } from "react";
import { useRobot } from "@/app/contexts/RobotContext";
import { RobotStatusRow } from "@/app/components/ui/RobotStatusRow";

type ActionStatus = "idle" | "sending" | "success" | "error";

type Waypoint = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
};

// Default within all safety planes: east y≤0.25, south x≤0.20, table z≥0.025
const DEFAULT_TARGET = { x: 0.15, y: 0.15, z: 0.30 };

const JOG_STEPS = [
  { label: "1 mm", value: 0.001 },
  { label: "5 mm", value: 0.005 },
  { label: "10 mm", value: 0.01 },
  { label: "50 mm", value: 0.05 },
];

/** Manual UR7e test page: jog controls, a waypoint queue, and a gripper test panel. */
export default function RobotTestPage() {
  const robot = useRobot();
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [jogStep, setJogStep] = useState(0.01);
  const initialized = useRef(false);

  const [queue, setQueue] = useState<Waypoint[]>([]);
  const [queueIndex, setQueueIndex] = useState<number | null>(null);
  const [addName, setAddName] = useState("");

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

  /** Sends a Cartesian move command to the robot and updates the status/message state. */
  async function sendMove(coords: { x: number; y: number; z: number }): Promise<boolean> {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("http://localhost:8001/robot/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: "cartesian",
          position: coords,
          speed_pct: 25,
          acceleration_pct: 25,
        }),
      });
      const data = await res.json();
      // A non-2xx here means the request itself was malformed (data.detail); a runtime
      // outcome that isn't a clean success still comes back 200 with data.status/data.error
      // — see app/api/python/main.py's POST /robot/move.
      if (res.ok && data.status === "success") {
        setStatus("success");
        setMessage(
          data.error ??
            `Moved to (${coords.x.toFixed(3)}, ${coords.y.toFixed(3)}, ${coords.z.toFixed(3)}) m.`
        );
        return true;
      } else {
        setStatus("error");
        setMessage(data.error ?? data.detail ?? "Server returned an error.");
        return false;
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Failed to reach server.");
      return false;
    }
  }

  /** Jogs one axis by the current step size from the robot's actual TCP position. */
  function handleJog(axis: "x" | "y" | "z", direction: 1 | -1) {
    // Always increment from actual TCP, not the UI target, so the step is exact.
    const base = robot.tcp_pose
      ? { x: robot.tcp_pose[0], y: robot.tcp_pose[1], z: robot.tcp_pose[2] }
      : target;
    const newTarget = {
      ...base,
      [axis]: parseFloat((base[axis] + direction * jogStep).toFixed(4)),
    };
    setTarget(newTarget);
    void sendMove(newTarget);
  }

  /** Appends a new waypoint to the queue. */
  function addWaypoint(coords: { x: number; y: number; z: number }, name = "") {
    setQueue((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, x: coords.x, y: coords.y, z: coords.z },
    ]);
    setAddName("");
  }

  /** Updates a single field of a waypoint by id. */
  function updateWaypoint(
    id: string,
    field: keyof Omit<Waypoint, "id">,
    value: string | number,
  ) {
    setQueue((prev) =>
      prev.map((wp) => (wp.id === id ? { ...wp, [field]: value } : wp)),
    );
  }

  /** Removes a waypoint from the queue by id. */
  function removeWaypoint(id: string) {
    setQueue((prev) => prev.filter((wp) => wp.id !== id));
  }

  /** Runs each queued waypoint in order, stopping immediately if any move fails. */
  async function handleRunQueue() {
    for (let i = 0; i < queue.length; i++) {
      setQueueIndex(i);
      const ok = await sendMove(queue[i]);
      if (!ok) break;
    }
    setQueueIndex(null);
  }

  const canRun =
    robot.connected &&
    robot.is_powered &&
    !robot.is_emergency_stopped &&
    !robot.is_protective_stopped &&
    status !== "sending";

  const canRunQueue = canRun && queue.length > 0 && queueIndex === null;

  return (
    <div className="max-w-3xl mx-auto mt-12 px-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-text">
          Robot Arm — Move Test
        </h1>
        <p className="text-sm text-muted mt-1">
          Sends Cartesian move commands to the UR7e via URscript. Robot must be
          connected, powered, and pendant in Remote Control mode.
        </p>
      </div>

      {/* Robot status summary */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-1 text-sm font-mono">
        <RobotStatusRow label="Connected" value={robot.connected} />
        <RobotStatusRow label="Powered" value={robot.is_powered} />
        <RobotStatusRow label="E-stop" value={robot.is_emergency_stopped} danger />
        <RobotStatusRow
          label="Protective stop"
          value={robot.is_protective_stopped}
          danger
        />
        <RobotStatusRow label="Program running" value={robot.is_program_running} />
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

      {/* Jog */}
      <div className="space-y-4">
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
            Each press moves the robot by one step from its actual current
            position.
          </p>
        </div>
      </div>

      {/* Move feedback */}
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

      <hr className="border-border" />

      {/* Waypoint Queue */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-text">Waypoint Queue</h2>

        {/* Add controls */}
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Name (optional)</span>
              <input
                type="text"
                placeholder="e.g. Home, Pick, Place"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addWaypoint(target, addName);
                }}
                className="rounded border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-teal"
              />
            </label>
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis} className="flex flex-col gap-1">
                <span className="text-xs text-muted uppercase tracking-wide">
                  {axis} (m)
                </span>
                <input
                  type="number"
                  step="0.001"
                  value={target[axis]}
                  onChange={(e) =>
                    setTarget((prev) => ({
                      ...prev,
                      [axis]: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="rounded border border-border bg-surface px-2 py-2 text-sm text-text tabular-nums focus:outline-none focus:ring-1 focus:ring-teal"
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => addWaypoint(target, addName)}
              className="flex-1 rounded border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-teal/10 transition-colors"
            >
              + Add Typed Coordinates
            </button>
            <button
              onClick={() => {
                const pos = robot.tcp_pose
                  ? {
                      x: robot.tcp_pose[0],
                      y: robot.tcp_pose[1],
                      z: robot.tcp_pose[2],
                    }
                  : target;
                addWaypoint(pos, addName);
              }}
              disabled={!robot.connected}
              className="flex-1 rounded border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              + Add Current Position
            </button>
          </div>
        </div>

        {/* Queue list */}
        {queue.length === 0 ? (
          <p className="text-sm text-muted text-center py-8 border border-dashed border-border rounded-lg">
            No waypoints — add some above.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[2rem_1fr_5.5rem_5.5rem_5.5rem_2rem] gap-2 px-2 text-xs text-muted uppercase tracking-wide">
              <span>#</span>
              <span>Name</span>
              <span>X (m)</span>
              <span>Y (m)</span>
              <span>Z (m)</span>
              <span />
            </div>
            {queue.map((wp, i) => (
              <div
                key={wp.id}
                className={`grid grid-cols-[2rem_1fr_5.5rem_5.5rem_5.5rem_2rem] gap-2 items-center rounded-lg px-2 py-1.5 transition-colors ${
                  queueIndex === i
                    ? "bg-teal/10 border border-teal/30"
                    : "border border-transparent hover:border-border"
                }`}
              >
                <span className="text-xs text-muted tabular-nums">{i + 1}</span>
                <input
                  type="text"
                  value={wp.name}
                  placeholder="—"
                  onChange={(e) => updateWaypoint(wp.id, "name", e.target.value)}
                  className="rounded border border-border bg-surface px-2 py-1 text-sm text-text focus:outline-none focus:ring-1 focus:ring-teal min-w-0 w-full"
                />
                {(["x", "y", "z"] as const).map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step="0.001"
                    value={wp[axis]}
                    onChange={(e) =>
                      updateWaypoint(
                        wp.id,
                        axis,
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    className="rounded border border-border bg-surface px-2 py-1 text-sm text-text tabular-nums focus:outline-none focus:ring-1 focus:ring-teal min-w-0 w-full"
                  />
                ))}
                <button
                  onClick={() => removeWaypoint(wp.id)}
                  disabled={queueIndex !== null}
                  className="text-muted hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-base leading-none transition-colors text-center"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleRunQueue}
            disabled={!canRunQueue}
            className="flex-1 rounded-lg px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-teal text-white hover:opacity-90 active:opacity-80"
          >
            {queueIndex !== null
              ? `Moving to waypoint ${queueIndex + 1} / ${queue.length}…`
              : `Run Queue (${queue.length} waypoint${queue.length !== 1 ? "s" : ""})`}
          </button>
          {queue.length > 0 && queueIndex === null && (
            <button
              onClick={() => setQueue([])}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted hover:text-red-400 hover:border-red-400/30 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {queueIndex !== null && queue[queueIndex] && (
          <p className="text-xs text-muted text-center">
            {queue[queueIndex].name ? `"${queue[queueIndex].name}" — ` : ""}(
            {queue[queueIndex].x.toFixed(3)},{" "}
            {queue[queueIndex].y.toFixed(3)},{" "}
            {queue[queueIndex].z.toFixed(3)}) m
          </p>
        )}
      </div>

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

const DEFAULT_GRIPPER = { position: 128, speed: 128, force: 50 };

/** Robotiq gripper test panel: sets position/speed/force registers and runs the gripper cycle URP. */
function GripperControl({ canRun }: { canRun: boolean }) {
  const [params, setParams] = useState(DEFAULT_GRIPPER);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  /** Posts the current gripper parameters to the server and runs the gripper test cycle. */
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
