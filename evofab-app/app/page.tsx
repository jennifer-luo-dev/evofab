// page.tsx (root)
// Root route; immediately redirects visitors to the pipelines flow.

import { redirect } from 'next/navigation';

/** Root route; redirects to the pipelines flow. */
export default function RootPage() {
  redirect('/pipelines');
}
