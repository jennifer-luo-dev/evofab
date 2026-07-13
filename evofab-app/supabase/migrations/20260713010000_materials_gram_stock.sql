-- v0.7 Materials UX Part A: canonical physical stock units and colored lots.

ALTER TABLE material_stock ADD COLUMN color TEXT;
UPDATE material_stock SET color = 'Unspecified' WHERE color IS NULL;
ALTER TABLE material_stock ALTER COLUMN color SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM material_stock WHERE unit = 'unit') THEN
    RAISE EXCEPTION 'Cannot migrate material_stock rows with unit=unit';
  END IF;
END;
$$;

ALTER TABLE material_stock DROP CONSTRAINT material_stock_unit_check;

UPDATE material_stock
SET quantity = quantity * 1000, unit = 'g'
WHERE unit IN ('kg', 'spool');

ALTER TABLE material_stock
  ADD CONSTRAINT material_stock_unit_check CHECK (unit IN ('g', 'l'));

DROP FUNCTION adjust_material_stock(UUID, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION intake_material_stock(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION intake_material_stock(
  p_material_id UUID,
  p_quantity NUMERIC,
  p_unit TEXT,
  p_color TEXT,
  p_lot_label TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_actor TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT now(),
  p_net_weight_grams NUMERIC DEFAULT 1000
) RETURNS material_stock LANGUAGE plpgsql AS $$
DECLARE
  created_stock material_stock;
  material_form TEXT;
  canonical_quantity NUMERIC;
  canonical_unit TEXT;
BEGIN
  SELECT form INTO material_form FROM materials WHERE id = p_material_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material not found'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'Intake quantity must be positive'; END IF;
  IF NULLIF(trim(p_color), '') IS NULL THEN RAISE EXCEPTION 'Lot color is required'; END IF;
  IF material_form = 'pellet' AND p_unit = 'kg' THEN
    canonical_quantity := p_quantity * 1000; canonical_unit := 'g';
  ELSIF material_form = 'filament' AND p_unit = 'spool' AND p_net_weight_grams > 0 THEN
    canonical_quantity := p_quantity * p_net_weight_grams; canonical_unit := 'g';
  ELSIF material_form = 'resin' AND p_unit = 'l' THEN
    canonical_quantity := p_quantity; canonical_unit := 'l';
  ELSE
    RAISE EXCEPTION 'Intake unit does not match material form';
  END IF;
  INSERT INTO material_stock
    (material_id, lot_label, quantity, unit, color, location, received_at, received_by, status)
  VALUES
    (p_material_id, NULLIF(trim(p_lot_label), ''), canonical_quantity, canonical_unit,
     trim(p_color), NULLIF(trim(p_location), ''), p_received_at, NULLIF(trim(p_actor), ''), 'in_stock')
  RETURNING * INTO created_stock;
  INSERT INTO material_events (material_id, stock_id, event_type, delta, actor, note)
  VALUES (p_material_id, created_stock.id, 'received', canonical_quantity,
          NULLIF(trim(p_actor), ''), NULLIF(trim(p_note), ''));
  RETURN created_stock;
END;
$$;

CREATE OR REPLACE FUNCTION adjust_material_stock(
  p_stock_id UUID,
  p_delta NUMERIC,
  p_actor TEXT,
  p_note TEXT
) RETURNS material_stock LANGUAGE plpgsql AS $$
DECLARE previous_stock material_stock; updated_stock material_stock; next_quantity NUMERIC;
BEGIN
  SELECT * INTO previous_stock FROM material_stock WHERE id = p_stock_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock row not found'; END IF;
  IF p_delta = 0 THEN RAISE EXCEPTION 'Adjustment delta cannot be zero'; END IF;
  IF NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Adjustment note is required'; END IF;
  next_quantity := previous_stock.quantity + p_delta;
  IF next_quantity < 0 THEN RAISE EXCEPTION 'Stock quantity cannot be negative'; END IF;
  UPDATE material_stock SET quantity = next_quantity,
    status = CASE WHEN next_quantity = 0 THEN 'depleted' WHEN previous_stock.status = 'low' THEN 'low' ELSE 'in_stock' END,
    updated_at = now()
  WHERE id = p_stock_id RETURNING * INTO updated_stock;
  INSERT INTO material_events (material_id, stock_id, event_type, delta, actor, note)
  VALUES (updated_stock.material_id, updated_stock.id, 'adjusted', p_delta,
          NULLIF(trim(p_actor), ''), trim(p_note));
  RETURN updated_stock;
END;
$$;
