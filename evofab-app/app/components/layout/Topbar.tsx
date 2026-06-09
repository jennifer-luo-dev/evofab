// Topbar.tsx
// Fixed top navigation bar that displays the lab identity and live status
// indicator dots for every hardware device in the SDL pipeline. The robot
// arm dot is driven by RobotContext; the camera dot is a static placeholder
// until camera status is tracked in the database.

"use client";

import { useRobot } from "@/app/contexts/RobotContext";
import type { RobotState } from "@/app/contexts/RobotContext";
import type { PrinterStatusType } from "@/app/types/printer";

const statusColor: Record<PrinterStatusType, string> = {
  idle: "bg-green",
  printing: "bg-amber animate-pulse-dot",
  paused: "bg-amber",
  error: "bg-red",
  offline: "bg-muted",
};

// Map live RTDE state onto the shared PrinterStatusType dot vocabulary so
// all device indicators use the same color semantics.
function robotDotStatus(r: RobotState): PrinterStatusType {
  if (!r.connected) return "offline";
  if (r.is_emergency_stopped || r.is_protective_stopped) return "error";
  if (r.is_moving || r.is_program_running) return "printing"; // active/running
  if (r.runtime_state === 4) return "paused"; // program paused on pendant
  if (r.is_powered) return "idle";
  return "offline";
}

export function Topbar() {
  const robot = useRobot();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-13 flex items-center justify-between px-6 bg-surface border-b border-border">
      <div className="flex items-center gap-3">
        <span className="font-mono text-teal text-sm font-bold tracking-wider">
          EVOFAB
        </span>
        <span className="text-border-2 text-lg select-none">/</span>
        <span className="font-mono text-muted text-xs tracking-wide">SDL</span>
        <div className="w-px h-4 bg-border-2 mx-2" />
        <span className="text-xs text-muted">
          Nemitz Robotics Lab · Tufts ME
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Robot arm — live via RTDE through RobotContext */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${statusColor[robotDotStatus(robot)]}`}
          />
          <span className="font-mono text-xs text-muted">UR7e</span>
        </div>

        {/* Camera — static placeholder until camera status is tracked */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${statusColor["idle"]}`}
          />
          <span className="font-mono text-xs text-muted">Camera</span>
        </div>
      </div>
    </header>
  );
}
