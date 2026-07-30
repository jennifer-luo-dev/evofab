// MoveTargetModal.tsx
// Popup for live-setting a robot-arm Move step's target — Cartesian or
// joint-space, chosen by a three-way toggle (Cartesian / Joint Absolute /
// Joint Relative) at the top. One modal, one internal state machine:
// switching to Cartesian shows the existing linked numeric fields + XY pad +
// Z slider + jog + quick actions (unchanged, reused as-is); switching to
// Joint shows one dial+numeric+jog row per joint instead. Confirming writes
// the whole result back to the caller; cancelling discards it.
//
// Jog presses, a pad-drag release, a Z-slider release, a joint-dial release,
// and "Home" all fire a real robot move via useLiveMove — mirroring
// app/robot-test/page.tsx's handleJog, which sends the same POST
// /api/robot-move on every jog click rather than waiting for an explicit
// confirm. Typed numeric entry and "Sync to Current" stay UI-only.

'use client'

import { useState } from 'react'
import { cn } from '@/app/lib/utils'
import { Modal } from '@/app/components/ui/Modal'
import { useRobot } from '@/app/contexts/RobotContext'
import { JOINT_NAMES, JOINT_LABELS, type JointName } from '@/app/lib/robot'
import { LinkedCoordinateFields } from './LinkedCoordinateFields'
import { XYPad } from './XYPad'
import { ZSlider } from './ZSlider'
import { JogControls } from './JogControls'
import { QuickActions } from './QuickActions'
import { JointRow } from './JointRow'
import { useLiveMove } from './useLiveMove'
import { clampPosition, type Position } from './positionMath'
import { clamp as clampNumber } from './jointMath'
import {
  ROBOT_BOUNDS,
  ROBOT_HOME_POSITION,
  JOINT_LIMITS_DEG,
  RELATIVE_DELTA_BOUNDS,
} from './constants'

export interface MoveTargetResult {
  targetType: 'cartesian' | 'joint'
  position: Position
  jointMode: 'absolute' | 'relative'
  joints: { joint: JointName; angle_deg: number }[]
  speedPct: number
  accelerationPct: number
}

interface MoveTargetModalProps {
  /** Seeded once on mount from the parent form's current inputs. The caller is expected to
   * mount this only while the picker should be open (e.g. `{pickerOpen && <MoveTargetModal .../>}`)
   * so a fresh mount — and thus a fresh seed — happens every time it's reopened. */
  initial: MoveTargetResult
  /** `machines.id` for the step's selected robot arm — `undefined` (no machine picked yet) disables live moves, leaving the picker as UI-only editing. */
  machineId?: string
  onCancel: () => void
  onConfirm: (result: MoveTargetResult) => void
}

type JointRowState = Record<JointName, { active: boolean; value: number }>

function seedJointRows(joints: MoveTargetResult['joints']): JointRowState {
  const byName = new Map(joints.map((j) => [j.joint, j.angle_deg]))
  const rows = {} as JointRowState
  for (const j of JOINT_NAMES) rows[j] = { active: byName.has(j), value: byName.get(j) ?? 0 }
  return rows
}

const TYPE_OPTIONS = [
  { key: 'cartesian', label: 'Cartesian' },
  { key: 'joint-absolute', label: 'Joint Absolute' },
  { key: 'joint-relative', label: 'Joint Relative' },
] as const

export function MoveTargetModal({ initial, machineId, onCancel, onConfirm }: MoveTargetModalProps) {
  const robot = useRobot()
  const [targetType, setTargetType] = useState<'cartesian' | 'joint'>(initial.targetType)
  const [jointMode, setJointMode] = useState<'absolute' | 'relative'>(initial.jointMode)
  const [position, setPosition] = useState<Position>(() => clampPosition(initial.position, ROBOT_BOUNDS))
  const [jointRows, setJointRows] = useState<JointRowState>(() => seedJointRows(initial.joints))
  const [speedPct, setSpeedPct] = useState(initial.speedPct)
  const [accelerationPct, setAccelerationPct] = useState(initial.accelerationPct)
  const { sendMove, sending, error } = useLiveMove()

  function update(next: Position) {
    setPosition(clampPosition(next, ROBOT_BOUNDS))
  }

  /** Same as `update`, plus fires the actual robot move — for discrete actions (jog, pad release, slider release, Home). */
  function updateAndMove(next: Position) {
    const clamped = clampPosition(next, ROBOT_BOUNDS)
    setPosition(clamped)
    if (machineId) {
      sendMove(machineId, {
        target_type: 'cartesian',
        position: clamped,
        speed_pct: speedPct,
        acceleration_pct: accelerationPct,
      })
    }
  }

  function updateJointRow(joint: JointName, value: number) {
    setJointRows((prev) => ({ ...prev, [joint]: { ...prev[joint], value } }))
  }

  /** Same as `updateJointRow`, plus fires a live single-joint move — for discrete actions (dial release, jog). */
  function commitJointRow(joint: JointName, value: number) {
    setJointRows((prev) => ({ ...prev, [joint]: { ...prev[joint], value } }))
    if (machineId) {
      sendMove(machineId, {
        target_type: 'joint',
        mode: jointMode,
        joints: [{ joint, angle_deg: value }],
        speed_pct: speedPct,
        acceleration_pct: accelerationPct,
      })
    }
  }

  function toggleJointActive(joint: JointName) {
    setJointRows((prev) => {
      const wasActive = prev[joint].active
      // Activating in absolute mode seeds the dial at the joint's live angle, if known —
      // the joint-space equivalent of QuickActions' "Sync to Current".
      const seed =
        !wasActive && jointMode === 'absolute' && robot.joint_positions_deg
          ? robot.joint_positions_deg[JOINT_NAMES.indexOf(joint)]
          : 0
      return { ...prev, [joint]: { active: !wasActive, value: wasActive ? prev[joint].value : seed } }
    })
  }

  function changeJointMode(mode: 'absolute' | 'relative') {
    setJointMode(mode)
    // Values mean different things across modes (target vs delta) — reset rather than
    // reinterpret, avoiding the mixed-mode ambiguity a per-row toggle would invite.
    setJointRows((prev) => {
      const next = {} as JointRowState
      for (const j of JOINT_NAMES) {
        const seed =
          mode === 'absolute' && robot.joint_positions_deg
            ? robot.joint_positions_deg[JOINT_NAMES.indexOf(j)]
            : 0
        next[j] = { active: prev[j].active, value: prev[j].active ? seed : 0 }
      }
      return next
    })
  }

  function rowBounds(joint: JointName) {
    return jointMode === 'absolute' ? JOINT_LIMITS_DEG[joint] : RELATIVE_DELTA_BOUNDS
  }

  function handleConfirm() {
    onConfirm({
      targetType,
      position,
      jointMode,
      joints: JOINT_NAMES.filter((j) => jointRows[j].active).map((j) => ({
        joint: j,
        angle_deg: jointRows[j].value,
      })),
      speedPct,
      accelerationPct,
    })
  }

  const activeTypeKey = targetType === 'cartesian' ? 'cartesian' : (`joint-${jointMode}` as const)

  return (
    <Modal
      open
      onClose={onCancel}
      title="Set Move Target"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-surface text-text border border-border"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal text-bg"
          >
            Use This Target
          </button>
        </>
      }
    >
      <div className="space-y-4 w-full">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                if (opt.key === 'cartesian') {
                  setTargetType('cartesian')
                } else {
                  setTargetType('joint')
                  changeJointMode(opt.key === 'joint-absolute' ? 'absolute' : 'relative')
                }
              }}
              className={cn(
                'px-2.5 py-1.5 font-semibold',
                activeTypeKey === opt.key ? 'bg-teal text-bg' : 'bg-surface text-muted'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {targetType === 'cartesian' ? (
          <>
            <LinkedCoordinateFields position={position} bounds={ROBOT_BOUNDS} onChange={update} />

            <div className="flex gap-3 items-stretch">
              <div className="flex-1 min-w-0">
                <XYPad
                  position={position}
                  bounds={ROBOT_BOUNDS}
                  onChange={(xy) => update({ ...position, ...xy })}
                  onCommit={(xy) => updateAndMove({ ...position, ...xy })}
                  disabled={sending}
                />
              </div>
              <ZSlider
                z={position.z}
                bounds={ROBOT_BOUNDS.z}
                onChange={(z) => update({ ...position, z })}
                onCommit={(z) => updateAndMove({ ...position, z })}
                disabled={sending}
              />
            </div>

            <JogControls position={position} bounds={ROBOT_BOUNDS} onChange={updateAndMove} disabled={sending} />

            <QuickActions homePosition={ROBOT_HOME_POSITION} onHome={updateAndMove} onSyncToCurrent={update} disabled={sending} />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {JOINT_NAMES.map((joint) => (
              <JointRow
                key={joint}
                joint={joint}
                label={JOINT_LABELS[joint]}
                active={jointRows[joint].active}
                value={jointRows[joint].value}
                bounds={rowBounds(joint)}
                mode={jointMode}
                liveAngleDeg={robot.joint_positions_deg?.[JOINT_NAMES.indexOf(joint)] ?? null}
                disabled={sending}
                onToggleActive={() => toggleJointActive(joint)}
                onChange={(v) => updateJointRow(joint, v)}
                onCommit={(v) => commitJointRow(joint, v)}
              />
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted font-medium">Speed %</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={speedPct}
              onChange={(e) => setSpeedPct(clampNumber(parseFloat(e.target.value) || 0, { min: 1, max: 100 }))}
              className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-text tabular-nums focus:outline-none focus:ring-1 focus:ring-teal"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted font-medium">Acceleration %</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={accelerationPct}
              onChange={(e) => setAccelerationPct(clampNumber(parseFloat(e.target.value) || 0, { min: 1, max: 100 }))}
              className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-text tabular-nums focus:outline-none focus:ring-1 focus:ring-teal"
            />
          </label>
        </div>

        {!machineId && (
          <p className="text-xs text-muted">Select a robot arm above to enable live moves.</p>
        )}
        {machineId && sending && <p className="text-xs text-muted">Moving robot…</p>}
        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    </Modal>
  )
}
