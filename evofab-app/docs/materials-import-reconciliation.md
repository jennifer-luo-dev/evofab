# Materials import reconciliation

## Fixture dry-run history (v0.7 Foundations, PR #22)

- `material_profiles`: three committed operational seeds were used.
- FGF Materials Database: the live Notion CSV was not present; the sanitized four-row fixture was used.
- SDS workbook: `Copy of commonly_used_materials_sds.xlsx` supplied on 2026-07-11 was inspected and used for the dry run. It contains 14 data rows: six filament, six pellet, and two resin.
- No production database writes were attempted.

| Source                    |  Input | Accepted | Merged | Skipped |
| ------------------------- | -----: | -------: | -----: | ------: |
| Operational profile seeds |      3 |        3 |      0 |       0 |
| Sanitized FGF CSV fixture |      4 |        4 |      0 |       0 |
| Supplied SDS workbook     |     14 |       14 |      0 |       0 |
| **Total source rows**     | **21** |   **21** |  **2** |   **0** |

Output catalog rows: **19**. Balance: `accepted 21 - merged 2 - skipped 0 = output 19`. The two fixture merges are Kraiburg `TF2ATL` and `TF3ATL`, whose FGF characterization rows receive the supplied SDS URLs.

## Live import (v0.7 Live Import, 2026-07-12)

### Evidence status

- `material_profiles`: three committed operational seeds (`pla-fgf`, `pla-fdm`, `cool-flex`).
- FGF Materials Database: live Notion export `FGF Materials Database.csv` (25 data rows, 31 columns). Column mapping fix applied: `Material Source` column (slugified `material-source`) added to the parser's source_status fallback chain; compound values like `Lab inventory - verified` parsed to extract the known status keyword.
- SDS workbook: `Copy of commonly_used_materials_sds.xlsx` (14 data rows: 6 filament, 6 pellet, 2 resin).
- Live database writes completed successfully via Supabase upsert on `slug`.

### Live dry-run balance

| Source                    |  Input | Accepted | Merged | Skipped |
| ------------------------- | -----: | -------: | -----: | ------: |
| Operational profile seeds |      3 |        3 |      0 |       0 |
| Live FGF CSV              |     25 |       25 |      0 |       0 |
| Supplied SDS workbook     |     14 |       14 |      5 |       0 |
| **Total source rows**     | **42** |   **42** |  **5** |   **0** |

Output catalog rows: **37**. Balance: `accepted 42 - merged 5 = output 37`.

### Merge details

Five SDS workbook rows merged onto existing FGF CSV rows by exact provider/name slug match, adding SDS URLs to verified Kraiburg pellet rows:

1. `kraiburg-tpe-tf1stl` — TF1STL (FGF CSV verified + SDS URL)
2. `kraiburg-tpe-tf2stl` — TF2STL (FGF CSV verified + SDS URL)
3. `kraiburg-tpe-tf2atl` — TF2ATL (FGF CSV verified + SDS URL)
4. `kraiburg-tpe-tf4atl` — TF4ATL (FGF CSV verified + SDS URL)
5. `kraiburg-tpe-tf5atl` — TF5ATL (FGF CSV verified + SDS URL)

### Status distribution (37 rows)

- **verified**: 16 rows
- **excluded**: 7 rows (4 RECREUS TPU, 2 KRAIBURG ZGO, 1 Yangzhou)
- **literature**: 4 rows (3 SEBS literature, 1 KRAIBURG EC)
- **supplier**: 10 rows

### Technology/form distribution (37 rows)

- FGF/pellet: 28 rows
- FDM/filament: 7 rows
- SLA/resin: 2 rows

These corrected distributions were verified read-only against the live 37-row catalog on 2026-07-12. They do not change the balanced import counts above.

### Source files

Both source files were untracked, never committed, and deleted from the working directory at session end (DECIDED-3).

## Orca profile research

The official OrcaSlicer global library distinguishes `Generic PLA @System` from vendor-specific profiles such as `Bambu PLA Basic @System`. Official guidance recommends the global profile unless a profile has truly been tuned for a specific printer. These names are reference evidence only: this train does not modify the slicer repository, its aliases, or the `cool-flex` placeholder.

- https://github.com/OrcaSlicer/OrcaSlicer/wiki/How-to-create-profiles
- https://github.com/OrcaSlicer/OrcaSlicer/blob/main/resources/profiles/OrcaFilamentLibrary/filament/Generic%20PLA%20%40System.json
- https://github.com/OrcaSlicer/OrcaSlicer/blob/main/resources/profiles/OrcaFilamentLibrary/filament/Bambu/Bambu%20PLA%20Basic%20%40System.json
