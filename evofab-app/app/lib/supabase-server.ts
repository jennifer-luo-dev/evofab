// supabase-server.ts
// Server-side Supabase client factory for use in Server Components and
// Route Handlers, wired up to read/write cookies via Next.js's request context.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Creates a Supabase server client that reads/writes cookies via the Next.js request context. Use in Server Components and Route Handlers. */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookie setting is a no-op
          }
        },
      },
    }
  )
}
