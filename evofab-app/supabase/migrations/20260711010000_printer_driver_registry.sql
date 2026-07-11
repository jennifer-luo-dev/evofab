ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS driver_type TEXT NOT NULL DEFAULT 'moonraker'
    CHECK (driver_type IN ('moonraker', 'prusalink')),
  ADD COLUMN IF NOT EXISTS moonraker_host TEXT,
  ADD COLUMN IF NOT EXISTS moonraker_port INTEGER,
  ADD COLUMN IF NOT EXISTS prusalink_host TEXT,
  ADD COLUMN IF NOT EXISTS prusalink_key_file TEXT;

UPDATE printers
SET moonraker_host = COALESCE(moonraker_host, ip),
    moonraker_port = COALESCE(moonraker_port, port)
WHERE driver_type = 'moonraker';

INSERT INTO printers (
  name, model, ip, port, type, material, build_volume, webcam_url,
  driver_type, moonraker_host, moonraker_port, prusalink_host,
  prusalink_key_file
) VALUES (
  'Printer 9', 'Prusa MINI+', '<PRUSA_IP>', 80, 'FDM', 'PLA Standard',
  '180x180x180mm', NULL, 'prusalink', NULL, NULL, '<PRUSA_IP>',
  '.secrets/prusalink.key'
)
ON CONFLICT (name) DO UPDATE SET
  model = EXCLUDED.model,
  driver_type = EXCLUDED.driver_type,
  moonraker_host = NULL,
  moonraker_port = NULL,
  prusalink_host = EXCLUDED.prusalink_host,
  prusalink_key_file = EXCLUDED.prusalink_key_file,
  is_active = TRUE;

INSERT INTO printer_status (printer_id, online, status)
SELECT id, FALSE, 'offline' FROM printers WHERE name = 'Printer 9'
ON CONFLICT (printer_id) DO NOTHING;
