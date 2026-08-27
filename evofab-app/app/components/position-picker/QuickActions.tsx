// QuickActions.tsx
// "Home" resets to a known-safe idle pose and — like the jog buttons — is a
// discrete action that also fires a live robot move. "Sync to Current" reads
// the UR7e's live TCP pose *and* joint angles straight from RobotContext's
// /ws/robot feed (main.py's _rtde_reader publishes both on every tick), so
// the caller can adopt the exact pose the arm is physically in — not just
// its Cartesian coordinates — regardless of which target-type tab is active
// when the user later confirms. It only updates the picker's UI state, since
// the robot is already there — disabled rather than faking a value when the
// robot isn't connected or hasn't reported a pose yet.

'use client'

import { useRobot } from '@/app/contexts/RobotContext'
import { JOINT_NAMES, type JointRotation } from '@/app/lib/robot'
import type { Orientation, Position } from './positionMath'

interface QuickActionsProps {
  homePosition: Position
  /** Fired for "Home" — the caller is expected to also trigger a live robot move here. */
  onHome: (pos: Position) => void
  /** Fired for "Sync to Current" — UI-only, no robot move (it's already at this pose). */
  onSyncToCurrent: (pos: Position, orientation: Orientation, joints: JointRotation[]) => void
  disabled?: boolean
}

export function QuickActions({ homePosition, onHome, onSyncToCurrent, disabled }: QuickActionsProps) {
  const robot = useRobot()
  const canSync = robot.connected && !!robot.tcp_pose && !!robot.joint_positions_deg

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onHome(homePosition)}
        disabled={disabled}
        className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Home
      </button>
      <button
        type="button"
        onClick={() => {
          if (!robot.tcp_pose || !robot.joint_positions_deg) return
          const joints = robot.joint_positions_deg
          onSyncToCurrent(
            { x: robot.tcp_pose[0], y: robot.tcp_pose[1], z: robot.tcp_pose[2] },
            { rx: robot.tcp_pose[3], ry: robot.tcp_pose[4], rz: robot.tcp_pose[5] },
            JOINT_NAMES.map((joint, i) => ({ joint, angle_deg: joints[i] }))
          )
        }}
        disabled={disabled || !canSync}
        title={canSync ? undefined : 'Robot not connected — live pose unavailable'}
        className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Sync to Current
      </button>
    </div>
  )
}
