// PositionPickerModal.tsx
// Popup for live-setting a robot-arm Move target: linked numeric fields, a
// draggable XY pad, a Z slider, jog buttons, and quick actions — all
// controlled from one `{x, y, z}` state held here. Confirming writes the
// result back to the caller; cancelling discards it.
//
// Jog presses, a pad-drag release, a Z-slider release, and "Home" also fire
// a real robot move via useLiveRobotMove — mirroring app/robot-test/page.tsx's
// handleJog, which sends the same POST /api/robot-move on every jog click
// rather than waiting for an explicit confirm. Typed numeric entry and "Sync
// to Current" stay UI-only, matching robot-test's own typed-field inputs
// (which likewise don't move-on-type).

'use client'

import { useState } from 'react'
import { Modal } from '@/app/components/ui/Modal'
import { LinkedCoordinateFields } from './LinkedCoordinateFields'
import { XYPad } from './XYPad'
import { ZSlider } from './ZSlider'
import { JogControls } from './JogControls'
import { QuickActions } from './QuickActions'
import { useLiveRobotMove } from './useLiveRobotMove'
import { clampPosition, type Position } from './positionMath'
import { ROBOT_BOUNDS, ROBOT_HOME_POSITION } from './constants'

interface PositionPickerModalProps {
  /** Seeded once on mount from the parent form's current X/Y/Z fields. The caller is expected to
   * mount this only while the picker should be open (e.g. `{pickerOpen && <PositionPickerModal .../>}`)
   * so a fresh mount — and thus a fresh seed — happens every time it's reopened. */
  initial: Position
  /** `machines.id` for the step's selected robot arm — `undefined` (no machine picked yet) disables live moves, leaving the picker as UI-only position editing. */
  machineId?: string
  onCancel: () => void
  onConfirm: (position: Position) => void
}

export function PositionPickerModal({
  initial,
  machineId,
  onCancel,
  onConfirm,
}: PositionPickerModalProps) {
  const [position, setPosition] = useState<Position>(() => clampPosition(initial, ROBOT_BOUNDS))
  const { sendMove, sending, error } = useLiveRobotMove()

  function update(next: Position) {
    setPosition(clampPosition(next, ROBOT_BOUNDS))
  }

  /** Same as `update`, plus fires the actual robot move — for discrete actions (jog, pad release, slider release, Home). */
  function updateAndMove(next: Position) {
    const clamped = clampPosition(next, ROBOT_BOUNDS)
    setPosition(clamped)
    if (machineId) sendMove(machineId, clamped)
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title="Set Target Position"
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
            onClick={() => onConfirm(position)}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal text-bg"
          >
            Use This Position
          </button>
        </>
      }
    >
      <div className="space-y-4 w-full">
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

        <QuickActions
          homePosition={ROBOT_HOME_POSITION}
          onHome={updateAndMove}
          onSyncToCurrent={update}
          disabled={sending}
        />

        {!machineId && (
          <p className="text-xs text-muted">Select a robot arm above to enable live moves.</p>
        )}
        {machineId && sending && <p className="text-xs text-muted">Moving robot…</p>}
        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    </Modal>
  )
}
