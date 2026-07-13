-- Keep the existing printer records so historical jobs retain their printer_id links.
DO $$
DECLARE
  fdm_id UUID;
  fgf_id UUID;
  temporary_ip TEXT := '192.0.2.89';
BEGIN
  SELECT id INTO fdm_id FROM printers WHERE name = 'FDM Printer' FOR UPDATE;
  SELECT id INTO fgf_id FROM printers WHERE name = 'FGF Printer' FOR UPDATE;

  IF fdm_id IS NULL OR fgf_id IS NULL THEN
    RAISE EXCEPTION 'Expected FDM Printer and FGF Printer registry rows';
  END IF;

  -- A temporary address avoids violating printers.ip's unique constraint while swapping.
  UPDATE printers SET ip = temporary_ip, moonraker_host = temporary_ip
  WHERE id = fdm_id AND ip = '10.247.137.21';

  UPDATE printers
  SET ip = '10.247.137.21', moonraker_host = '10.247.137.21',
      moonraker_port = COALESCE(moonraker_port, port), type = 'FGF'
  WHERE id = fgf_id;

  UPDATE printers
  SET ip = '10.247.137.89', moonraker_host = '10.247.137.89',
      moonraker_port = COALESCE(moonraker_port, port), type = 'FDM'
  WHERE id = fdm_id;
END $$;
