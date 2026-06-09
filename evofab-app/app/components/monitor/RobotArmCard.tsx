// RobotArmCard.tsx
// Monitor card that displays live UR7e robot arm metrics sourced from
// RobotContext (status, moving state, speed slider). The program name is
// the only prop because it comes from a separate UR Dashboard Server query
// (port 29999) rather than RTDE — pass it from the parent when available.

"use client";

import { useRobot } from "@/app/contexts/RobotContext";
import type { RobotState } from "@/app/contexts/RobotContext";
import { MetricBox } from "@/app/components/ui/MetricBox";

interface RobotArmCardProps {
  // Current URScript program name from the UR Dashboard Server.
  // Defaults to "—" until that integration is implemented.
  program?: string;
}

// Translate raw RTDE integers and booleans into a single human-readable label.
function describeStatus(r: RobotState): string {
  if (!r.connected) return "Offline";
  if (r.is_emergency_stopped) return "E-Stop";
  if (r.is_protective_stopped) return "Protected";
  if (!r.is_powered) return "Powered off";
  // runtime_state 2 = PLAYING
  if (r.runtime_state === 2) return "Running";
  // runtime_state 4 = PAUSED
  if (r.runtime_state === 4) return "Paused";
  // robot_mode 5 = IDLE
  if (r.robot_mode === 5) return "Idle";
  return "Ready";
}

export function RobotArmCard({ program = "—" }: RobotArmCardProps) {
  const robot = useRobot();

  return (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Robot Arm
        </h3>
        <span className="font-mono text-xs text-[var(--color-teal)]">UR7e</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricBox label="Program" value={program} />
        <MetricBox label="Status" value={describeStatus(robot)} />
        <MetricBox
          label="Moving"
          value={robot.connected ? (robot.is_moving ? "Yes" : "No") : "—"}
        />
        <MetricBox
          label="Speed"
          value={robot.connected ? String(robot.speed_fraction) : "—"}
          unit="%"
        />
      </div>
    </div>
  );
}
