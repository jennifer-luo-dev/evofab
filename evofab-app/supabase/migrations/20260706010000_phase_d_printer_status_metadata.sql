-- Phase D printer status metadata for honest monitoring and Klipper recovery.

ALTER TABLE printer_status
  ADD COLUMN IF NOT EXISTS progress_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (progress_source IN ('exact', 'estimated', 'unknown')),
  ADD COLUMN IF NOT EXISTS layer_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (layer_source IN ('exact', 'estimated', 'unknown')),
  ADD COLUMN IF NOT EXISTS fault_message TEXT,
  ADD COLUMN IF NOT EXISTS fault_mcu TEXT;
