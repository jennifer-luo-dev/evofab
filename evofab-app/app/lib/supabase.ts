import { createBrowserClient } from '@supabase/ssr'

/** Creates a Supabase browser client using public env vars. Use in Client Components. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
