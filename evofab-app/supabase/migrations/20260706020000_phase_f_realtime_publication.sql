-- Phase F realtime publication guard.
-- Keeps dashboard subscriptions available on fresh Supabase projects.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'jobs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'logs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.logs;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'printer_status'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.printer_status;
    END IF;
  END IF;
END $$;
