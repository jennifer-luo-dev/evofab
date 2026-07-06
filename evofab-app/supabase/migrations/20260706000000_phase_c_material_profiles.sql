-- Phase C cloud slicer material profiles.
-- Replaces the older UUID-based print-settings preset table with the final
-- FGF slicer profile schema from the evofab-slicer contract.

ALTER TABLE IF EXISTS jobs DROP CONSTRAINT IF EXISTS jobs_material_profile_id_fkey;

ALTER TABLE IF EXISTS jobs
  ALTER COLUMN material_profile_id TYPE TEXT USING material_profile_id::TEXT;

DROP TABLE IF EXISTS material_profiles;

CREATE TABLE material_profiles (
  id                              TEXT        PRIMARY KEY,
  name                            TEXT        NOT NULL UNIQUE,
  polymer                         TEXT        NOT NULL,
  nozzle_diameter_mm              NUMERIC(8,3) NOT NULL,
  layer_height_mm                 NUMERIC(8,3) NOT NULL,
  line_width_mm                   NUMERIC(8,3) NOT NULL,
  temps_json                      JSONB       NOT NULL DEFAULT '{}',
  rotation_volume_mm3             NUMERIC(10,3) NOT NULL,
  pellet_flow_coefficient         NUMERIC(8,4) NOT NULL,
  pressure_advance                NUMERIC(8,4) NOT NULL,
  pressure_advance_smooth_time    NUMERIC(8,4) NOT NULL,
  max_volumetric_speed_mm3_s      NUMERIC(10,3) NOT NULL,
  min_layer_time_s                NUMERIC(10,3) NOT NULL,
  cooling_json                    JSONB       NOT NULL DEFAULT '{}',
  overrides_json                  JSONB       NOT NULL DEFAULT '{}',
  density_g_cm3                   NUMERIC(8,4) NOT NULL,
  notes                           TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_material_profile_id_fkey
  FOREIGN KEY (material_profile_id)
  REFERENCES material_profiles(id)
  ON DELETE SET NULL;

INSERT INTO material_profiles (
  id,
  name,
  polymer,
  nozzle_diameter_mm,
  layer_height_mm,
  line_width_mm,
  temps_json,
  rotation_volume_mm3,
  pellet_flow_coefficient,
  pressure_advance,
  pressure_advance_smooth_time,
  max_volumetric_speed_mm3_s,
  min_layer_time_s,
  cooling_json,
  overrides_json,
  density_g_cm3,
  notes
) VALUES (
  'pla-virgin-3mm',
  'Virgin PLA — 3 mm nozzle',
  'PLA',
  3.0,
  1.2,
  4.0,
  '{"feeding": 190, "melting": 190, "nozzle": 190, "bed": 60}',
  210,
  1,
  0.3,
  0.5,
  250,
  60,
  '{"fan_min_pct": 0, "fan_max_pct": 0, "no_cooling_first_layers": 4}',
  '{"retraction_length_mm": 2.0, "extra_length_on_restart_mm": 0.0, "wipe_distance_mm": 2.0, "z_hop_mm": 1.0}',
  1.24,
  ''
);
