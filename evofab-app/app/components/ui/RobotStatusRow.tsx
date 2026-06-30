interface RobotStatusRowProps {
  label: string
  value: boolean
  danger?: boolean
}

export function RobotStatusRow({ label, value, danger = false }: RobotStatusRowProps) {
  const color = danger && value ? 'text-red-400' : value ? 'text-teal' : 'text-muted'
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={color}>{value ? 'yes' : 'no'}</span>
    </div>
  )
}
