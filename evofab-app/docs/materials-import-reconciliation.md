# Materials import reconciliation

## Evidence status

- `material_profiles`: three committed operational seeds were used.
- FGF Materials Database: the live Notion CSV was not present; the sanitized four-row fixture was used.
- SDS workbook: `Copy of commonly_used_materials_sds.xlsx` supplied on 2026-07-11 was inspected and used for the dry run. It contains 14 data rows: six filament, six pellet, and two resin.
- No production database writes were attempted.

## Dry-run balance

| Source                    |  Input | Accepted | Merged | Skipped |
| ------------------------- | -----: | -------: | -----: | ------: |
| Operational profile seeds |      3 |        3 |      0 |       0 |
| Sanitized FGF CSV fixture |      4 |        4 |      0 |       0 |
| Supplied SDS workbook     |     14 |       14 |      0 |       0 |
| **Total source rows**     | **21** |   **21** |  **2** |   **0** |

Output catalog rows: **19**. Balance: `accepted 21 - merged 2 - skipped 0 = output 19`. The two fixture merges are Kraiburg `TF2ATL` and `TF3ATL`, whose FGF characterization rows receive the supplied SDS URLs.

The fixture dry run intentionally does not claim production completeness. The live FGF export may overlap the six Kraiburg SDS rows; the importer merges exact provider/name identities and will report the resulting merge count.

## Required live-run export

William must export the Notion database with all properties as exactly `FGF Materials Database.csv`. The supplied SDS workbook is usable as the second live source. Live mode also requires the three deployed `material_profiles` rows represented by the committed seed fixture and valid server-side Supabase credentials.

## Orca profile research

The official OrcaSlicer global library distinguishes `Generic PLA @System` from vendor-specific profiles such as `Bambu PLA Basic @System`. Official guidance recommends the global profile unless a profile has truly been tuned for a specific printer. These names are reference evidence only: this train does not modify the slicer repository, its aliases, or the `cool-flex` placeholder.

- https://github.com/OrcaSlicer/OrcaSlicer/wiki/How-to-create-profiles
- https://github.com/OrcaSlicer/OrcaSlicer/blob/main/resources/profiles/OrcaFilamentLibrary/filament/Generic%20PLA%20%40System.json
- https://github.com/OrcaSlicer/OrcaSlicer/blob/main/resources/profiles/OrcaFilamentLibrary/filament/Bambu/Bambu%20PLA%20Basic%20%40System.json
