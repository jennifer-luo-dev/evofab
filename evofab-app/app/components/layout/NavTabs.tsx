// NavTabs.tsx: React component for tabs associated with site pages
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/app/lib/utils'
import { useJob } from '@/app/contexts/JobContext'

const TABS = [
  { label: 'Setup',       href: '/setup' },
  { label: 'Monitor',     href: '/monitor' },
  { label: 'Results',     href: '/results' },
  { label: 'History',     href: '/history' },
  // TODO: remove when robot motion is integrated into the main flow
  { label: 'Robot Test',        href: '/robot-test' },
  { label: 'Actuation Test',    href: '/actuation-test' },
  { label: 'Classification',    href: '/classification-test' },
  { label: 'Camera Test',       href: '/camera-test' },
]

export function NavTabs() {
  const pathname = usePathname()
  const { jobActive, currentJobId, resultCount } = useJob()

  return (
    <nav className="flex items-center gap-1 px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href)
        const href = tab.href === '/monitor' && currentJobId
          ? `/monitor/${currentJobId}`
          : tab.href === '/results' && currentJobId
          ? `/results/${currentJobId}`
          : tab.href

        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              'relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors',
              isActive
                ? 'text-[var(--color-text)] border-b-2 border-[var(--color-teal)] -mb-px'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
            )}
          >
            {tab.label}
            {tab.label === 'Monitor' && jobActive && (
              <span className="inline-flex items-center justify-center w-1.5 h-1.5 rounded-full bg-[var(--color-teal)] animate-pulse-dot" />
            )}
            {tab.label === 'Results' && resultCount > 0 && (
              <span className="animate-badge-pop inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-[var(--color-teal)]/20 text-[var(--color-teal)] text-[10px] font-bold">
                {resultCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
