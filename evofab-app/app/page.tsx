// page.tsx (root)
// Root route; immediately redirects visitors to the setup flow.

import { redirect } from 'next/navigation'

/** Root route; redirects to the setup flow. */
export default function RootPage() {
  redirect('/setup')
}
