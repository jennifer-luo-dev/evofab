// icons.tsx
// Hand-rolled inline SVG icon set for the Pipelines/History/Machine Settings
// pages (technology/machine-type glyphs, row action icons, and the small
// step connector). Kept as plain inline SVG — matching the ArcGauge
// convention — rather than adding to the app's minimal lucide-react usage,
// since these are one-off decorative glyphs rather than a general icon set.

import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

/** Printer technology/machine-type icon. */
export function PrinterIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="3" y="6" width="10" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 6V3.5h7V6M5 13.5h6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/** Robot arm technology/machine-type icon. */
export function ArmIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...props}>
      <path
        d="M3 13 L6 8 L10 9 L13 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="13" cy="4" r="1.4" fill="currentColor" />
    </svg>
  )
}

/** Arduino board technology/machine-type icon. */
export function ArduinoIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="2.5" y="5" width="11" height="6" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="8" r="0.9" fill="currentColor" />
      <circle cx="10.5" cy="8" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** Classification model technology/machine-type icon. */
export function ModelIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.3 5 L7 10.5M10.7 5 L9 10.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

/** Camera technology/machine-type icon. */
export function CameraIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="2" y="5" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 5 L7 3.5h2L10 5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/** Load cell / gauge machine-type icon. */
export function GaugeIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 8 L11 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** Link/sync glyph shown next to synced pipeline step groups. */
export function LinkIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" {...props}>
      <path
        d="M6.5 9.5 L9.5 6.5M6 10.5 L4.5 12a2.1 2.1 0 0 1-3-3L3 7.5M10 5.5 L11.5 4a2.1 2.1 0 0 1 3 3L13 8.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Chevron-up icon, used for the reorder-step-up row action. */
export function UpIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" {...props}>
      <path
        d="M4 10 L8 6 L12 10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Chevron-down icon, used for the reorder-step-down row action. */
export function DownIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" {...props}>
      <path
        d="M4 6 L8 10 L12 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Pencil icon for the edit-step/edit-machine row action. */
export function EditIcon(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" {...props}>
      <path
        d="M11 2.5 L13.5 5 L5 13.5 L2 14 L2.5 11 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Trash icon for the delete-step/delete-machine row action. */
export function TrashIcon(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" {...props}>
      <path
        d="M3 5h10M6.5 5V3.5h3V5M4.5 5 L5 13.5h6L11.5 5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Play/triangle glyph — trigger for test-running a step outside a full pipeline run. */
export function PlayIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M4.5 3 L13 8 L4.5 13 Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

/** Crosshair/target glyph — trigger for the robot-arm position picker. */
export function TargetIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <path
        d="M8 0.5V3M8 13V15.5M0.5 8H3M13 8H15.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Small decorative curved connector drawn between consecutive pipeline steps. */
export function StepConnectorGlyph(props: IconProps) {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" {...props}>
      <path
        d="M7 0 C 12 4, 2 6, 7 9 C 12 12, 2 14, 7 18"
        stroke="var(--color-teal)"
        strokeWidth="1.4"
        fill="none"
        opacity="0.55"
      />
    </svg>
  )
}

/**
 * A machine type's `type_key` (see `machine_types.type_key` in
 * evofab-app/supabase/schema.sql). Free-form lowercase snake_case — not a
 * closed set — so icon lookups must tolerate unrecognized keys.
 */
export type MachineTypeKey = string

/**
 * Icon lookup keyed by known `type_key` values, with `DEFAULT` as the
 * fallback for unrecognized keys. Look up as
 * `MACHINE_TYPE_ICONS[key] ?? MACHINE_TYPE_ICONS.DEFAULT` (a plain indexed
 * access, not a wrapping function call, so component identity stays stable
 * across renders).
 */
export const MACHINE_TYPE_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  printer: PrinterIcon,
  arm: ArmIcon,
  robot_arm: ArmIcon,
  arduino: ArduinoIcon,
  arduino_board: ArduinoIcon,
  camera: CameraIcon,
  model: ModelIcon,
  classification_model: ModelIcon,
  gauge: GaugeIcon,
  load_cell: GaugeIcon,
  DEFAULT: GaugeIcon,
}
