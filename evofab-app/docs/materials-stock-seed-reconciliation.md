# v0.7 materials stock seed reconciliation

The seed script refuses a live run unless the catalog contains exactly 37 materials and no `v0.7-seed-*` lot exists. It calls `intake_material_stock` once per material, which creates both the lot and append-only received event atomically.

| Form     | Lot color | Quantity per lot | Canonical unit |
| -------- | --------- | ---------------- | -------------- |
| Pellet   | Natural   | 1 kg bag         | 1000 g         |
| Filament | Black     | 1 spool          | 1000 g         |
| Resin    | Clear     | 1.0 L            | 1.0 L          |

## Verified run evidence

The migration and seed completed on 2026-07-12 using the service-role environment key outside client code. A dry run immediately before the live run found 37 catalog rows and zero seed lots; the live run created 37 lots through `intake_material_stock`.

```json
{
  "dry_run": false,
  "existing_seed_lots": 0,
  "rows": 37,
  "by_technology": { "FDM": 7, "FGF": 28, "SLA": 2 },
  "by_form": {
    "pellet": { "rows": 28, "unit": "g", "total": 28000 },
    "filament": { "rows": 7, "unit": "g", "total": 7000 },
    "resin": { "rows": 2, "unit": "l", "total": 2 }
  }
}
```
