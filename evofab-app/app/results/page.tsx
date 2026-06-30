// page.tsx (results index)
// Results index route with no job selected; shows the empty state.

import { ResultsEmptyState } from '@/app/components/results/ResultsEmptyState'

/** Results index route with no job selected; shows the empty state. */
export default function ResultsIndexPage() {
  return <ResultsEmptyState jobId="" />
}
