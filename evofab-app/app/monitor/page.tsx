import { MonitorEmptyState } from '@/app/components/monitor/MonitorEmptyState'

/** Monitor index route with no active job selected; shows the empty state. */
export default function MonitorIndexPage() {
  return <MonitorEmptyState jobId="" />
}
