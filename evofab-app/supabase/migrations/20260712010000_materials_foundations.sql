-- v0.7 Materials Foundations: catalog, stock, append-only events, and profile bindings.

CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  technology TEXT NOT NULL CHECK (technology IN ('FDM', 'FGF', 'SLA')),
  form TEXT NOT NULL CHECK (form IN ('filament', 'pellet', 'resin')),
  provider TEXT,
  base_chemistry TEXT,
  nominal_hardness TEXT,
  source_status TEXT NOT NULL DEFAULT 'supplier'
    CHECK (source_status IN ('verified', 'excluded', 'literature', 'supplier')),
  sds_url TEXT,
  science JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE material_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  lot_label TEXT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('spool', 'kg', 'l', 'unit')),
  location TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by TEXT,
  status TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock', 'low', 'depleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE material_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  stock_id UUID REFERENCES material_stock(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('received', 'consumed', 'adjusted', 'retired')),
  delta NUMERIC(12,3),
  actor TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE material_profiles
  ADD COLUMN material_id UUID REFERENCES materials(id) ON DELETE SET NULL;

CREATE INDEX idx_materials_catalog_filter ON materials (technology, source_status, is_active);
CREATE INDEX idx_material_stock_material_status ON material_stock (material_id, status);
CREATE INDEX idx_material_events_stock_created ON material_events (stock_id, created_at DESC);
CREATE INDEX idx_material_events_material_created ON material_events (material_id, created_at DESC);
CREATE INDEX idx_material_profiles_material_id ON material_profiles (material_id);

CREATE OR REPLACE FUNCTION intake_material_stock(
  p_material_id UUID,
  p_quantity NUMERIC,
  p_unit TEXT,
  p_lot_label TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_actor TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT now()
) RETURNS material_stock LANGUAGE plpgsql AS $$
DECLARE created_stock material_stock;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'Intake quantity must be positive'; END IF;
  INSERT INTO material_stock
    (material_id, lot_label, quantity, unit, location, received_at, received_by, status)
  VALUES
    (p_material_id, NULLIF(trim(p_lot_label), ''), p_quantity, p_unit,
     NULLIF(trim(p_location), ''), p_received_at, NULLIF(trim(p_actor), ''), 'in_stock')
  RETURNING * INTO created_stock;
  INSERT INTO material_events (material_id, stock_id, event_type, delta, actor, note)
  VALUES (p_material_id, created_stock.id, 'received', p_quantity,
          NULLIF(trim(p_actor), ''), NULLIF(trim(p_note), ''));
  RETURN created_stock;
END;
$$;

CREATE OR REPLACE FUNCTION adjust_material_stock(
  p_stock_id UUID,
  p_quantity NUMERIC,
  p_status TEXT,
  p_actor TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS material_stock LANGUAGE plpgsql AS $$
DECLARE previous_stock material_stock; updated_stock material_stock;
BEGIN
  SELECT * INTO previous_stock FROM material_stock WHERE id = p_stock_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock row not found'; END IF;
  IF p_quantity < 0 THEN RAISE EXCEPTION 'Stock quantity cannot be negative'; END IF;
  UPDATE material_stock SET quantity = p_quantity, status = p_status, updated_at = now()
  WHERE id = p_stock_id RETURNING * INTO updated_stock;
  INSERT INTO material_events (material_id, stock_id, event_type, delta, actor, note)
  VALUES (updated_stock.material_id, updated_stock.id, 'adjusted',
          p_quantity - previous_stock.quantity, NULLIF(trim(p_actor), ''), NULLIF(trim(p_note), ''));
  RETURN updated_stock;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_material_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'material_events is append-only'; END;
$$;

CREATE TRIGGER material_events_no_update
BEFORE UPDATE OR DELETE ON material_events
FOR EACH ROW EXECUTE FUNCTION prevent_material_event_mutation();

-- SLA remains catalog-only; this only permits a future registry row.
ALTER TABLE printers DROP CONSTRAINT IF EXISTS printers_type_check;
ALTER TABLE printers ADD CONSTRAINT printers_type_check CHECK (type IN ('FGF', 'FDM', 'SLA'));
