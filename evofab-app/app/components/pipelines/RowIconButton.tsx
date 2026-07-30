// RowIconButton.tsx
// Small icon-only action button used in a step or loop row's trailing
// controls. Shared by ContainerView (step rows) and LoopBlock (loop header).

import type { ReactNode } from 'react'

export function RowIconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-1.25 rounded-md text-muted hover:bg-bg hover:text-text"
    >
      {children}
    </button>
  )
}
