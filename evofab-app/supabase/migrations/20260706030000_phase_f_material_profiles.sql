-- Phase F material profiles for daily-operation print settings.
-- This supersedes the Phase C slicer-oriented profile shape for dashboard use.

ALTER TABLE IF EXISTS jobs DROP CONSTRAINT IF EXISTS jobs_material_profile_id_fkey;

DROP TABLE IF EXISTS material_profiles;

CREATE TABLE material_profiles (
  id           TEXT        PRIMARY KEY,
  name         TEXT        NOT NULL UNIQUE,
  printer_type TEXT        NOT NULL DEFAULT 'BOTH'
                           CHECK (printer_type IN ('FGF', 'FDM', 'BOTH')),
  nozzle_temp  NUMERIC(6,2) NOT NULL,
  bed_temp     NUMERIC(6,2) NOT NULL,
  speed        NUMERIC(8,2) NOT NULL,
  flow_rate    NUMERIC(8,4) NOT NULL,
  fan_speed    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (fan_speed BETWEEN 0 AND 100),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_material_profile_id_fkey
  FOREIGN KEY (material_profile_id)
  REFERENCES material_profiles(id)
  ON DELETE SET NULL;

INSERT INTO material_profiles (
  id,
  name,
  printer_type,
  nozzle_temp,
  bed_temp,
  speed,
  flow_rate,
  fan_speed,
  notes
) VALUES
  ('pla-fgf', 'PLA FGF', 'FGF', 190, 60, 40, 1, 0, 'Baseline pellet PLA profile for the custom FGF printer.'),
  ('pla-fdm', 'PLA FDM', 'FDM', 205, 60, 55, 1, 80, 'Baseline filament PLA profile for FDM printers.'),
  ('cool-flex', 'Flexible Polymer', 'BOTH', 220, 50, 25, 0.95, 35, 'Shared conservative profile for flexible-material trials.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  printer_type = EXCLUDED.printer_type,
  nozzle_temp = EXCLUDED.nozzle_temp,
  bed_temp = EXCLUDED.bed_temp,
  speed = EXCLUDED.speed,
  flow_rate = EXCLUDED.flow_rate,
  fan_speed = EXCLUDED.fan_speed,
  notes = EXCLUDED.notes;
