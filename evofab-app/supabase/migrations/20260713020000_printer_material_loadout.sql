-- v0.7 Materials UX Part B: the current physical lot loaded on a printer.
CREATE TABLE printer_material_loadout (
  printer_id UUID PRIMARY KEY REFERENCES printers(id) ON DELETE CASCADE,
  stock_id UUID NOT NULL UNIQUE REFERENCES material_stock(id) ON DELETE RESTRICT,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  loaded_by TEXT,
  note TEXT
);

CREATE INDEX idx_printer_material_loadout_stock ON printer_material_loadout(stock_id);
