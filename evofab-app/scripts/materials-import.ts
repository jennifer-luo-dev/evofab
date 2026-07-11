import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { createClient } from "@supabase/supabase-js";

export type CatalogRow = {
  slug: string;
  name: string;
  technology: "FDM" | "FGF" | "SLA";
  form: "filament" | "pellet" | "resin";
  provider: string | null;
  base_chemistry: string | null;
  nominal_hardness: string | null;
  source_status: "verified" | "excluded" | "literature" | "supplier";
  sds_url: string | null;
  science: Record<string, unknown>;
  is_active: boolean;
};
export type ProfileSeed = { id: string; name: string; printer_type: string };
export type Reconciliation = {
  input: number;
  accepted: number;
  merged: number;
  skipped: number;
  output: number;
};

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function cell(value: unknown) {
  return String(value ?? "").trim();
}
function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else current += char;
  }
  values.push(current.trim());
  return values;
}

export async function readFgfCsv(file: string): Promise<CatalogRow[]> {
  const lines = (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  const headers = parseCsvLine(lines.shift() ?? "").map(slugify);
  return lines.map(parseCsvLine).flatMap((values) => {
    const row = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
    const name = cell(row.name || row.material || row["material-name-id"]);
    if (!name) return [];
    const status = slugify(
      cell(row["source-status"] || row.status || "supplier"),
    );
    const provider = cell(row.provider || row.supplier);
    return [
      {
        slug: slugify(`${provider}-${name}`),
        name,
        technology: "FGF" as const,
        form: "pellet" as const,
        provider: provider || null,
        base_chemistry:
          cell(row["base-chemistry"] || row.chemistry || row.polymer) || null,
        nominal_hardness: cell(row["nominal-hardness"] || row.hardness) || null,
        source_status: ([
          "verified",
          "excluded",
          "literature",
          "supplier",
        ].includes(status)
          ? status
          : "supplier") as CatalogRow["source_status"],
        sds_url: cell(row["sds-url"] || row["sds-links"]) || null,
        science: Object.fromEntries(
          Object.entries(row).filter(
            ([key, value]) =>
              value &&
              ![
                "name",
                "material",
                "provider",
                "supplier",
                "status",
                "source-status",
                "sds-url",
                "sds-links",
              ].includes(key),
          ),
        ),
        is_active: status !== "excluded",
      },
    ];
  });
}

export async function readSdsXlsx(file: string): Promise<CatalogRow[]> {
  const archive = unzipSync(new Uint8Array(await fs.readFile(file)));
  const decode = (value: string) =>
    value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const sharedXml = archive["xl/sharedStrings.xml"]
    ? strFromU8(archive["xl/sharedStrings.xml"])
    : "";
  const shared = [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map(
    (match) =>
      decode(
        [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((part) => part[1])
          .join(""),
      ),
  );
  const sheetFile = Object.keys(archive)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];
  if (!sheetFile) return [];
  const sheetXml = strFromU8(archive[sheetFile]);
  const rows: CatalogRow[] = [];
  for (const rowMatch of sheetXml.matchAll(
    /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g,
  )) {
    if (rowMatch[1] === "1") continue;
    const values: Record<string, string> = {};
    for (const match of rowMatch[2].matchAll(
      /<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g,
    )) {
      const raw =
        match[3].match(/<v>([\s\S]*?)<\/v>/)?.[1] ??
        match[3].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ??
        "";
      values[match[1]] = match[2].includes('t="s"')
        ? (shared[Number(raw)] ?? "")
        : decode(raw);
    }
    const formRaw = cell(values.A).toLowerCase();
    const provider = cell(values.B);
    const name = cell(values.C);
    const sds = cell(values.D);
    if (!name || !["filament", "pellet", "resin"].includes(formRaw)) continue;
    const form = formRaw as CatalogRow["form"];
    rows.push({
      slug: slugify(`${provider}-${name}`),
      name,
      technology: form === "resin" ? "SLA" : form === "pellet" ? "FGF" : "FDM",
      form,
      provider: provider || null,
      base_chemistry: null,
      nominal_hardness: null,
      source_status: "supplier",
      sds_url: sds || null,
      science: {},
      is_active: true,
    });
  }
  return rows;
}

export async function readProfiles(file: string): Promise<ProfileSeed[]> {
  return JSON.parse(await fs.readFile(file, "utf8")) as ProfileSeed[];
}

export function reconcile(sources: CatalogRow[][]) {
  const map = new Map<string, CatalogRow>();
  let merged = 0;
  for (const row of sources.flat()) {
    const key = row.slug;
    const prior = map.get(key);
    if (prior) {
      merged++;
      map.set(key, {
        ...prior,
        ...row,
        slug: key,
        provider: row.provider ?? prior.provider,
        base_chemistry: row.base_chemistry ?? prior.base_chemistry,
        nominal_hardness: row.nominal_hardness ?? prior.nominal_hardness,
        sds_url: row.sds_url ?? prior.sds_url,
        science: { ...prior.science, ...row.science },
        source_status:
          prior.source_status === "verified" ? "verified" : row.source_status,
        is_active: prior.source_status === "excluded" ? false : row.is_active,
      });
    } else map.set(key, row);
  }
  return { rows: [...map.values()], merged };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  const dryRun = args.includes("--dry-run");
  const fgfFile = value("--fgf");
  const sdsFile = value("--sds");
  const profilesFile = value("--profiles");
  if (!fgfFile || !sdsFile || !profilesFile)
    throw new Error(
      "Required: --fgf FILE --sds FILE --profiles FILE [--dry-run]",
    );
  const [fgf, sds, profiles] = await Promise.all([
    readFgfCsv(fgfFile),
    readSdsXlsx(sdsFile),
    readProfiles(profilesFile),
  ]);
  const profileRows: CatalogRow[] = profiles.map((profile) => ({
    slug: slugify(profile.id),
    name: profile.name,
    technology: profile.printer_type === "FDM" ? "FDM" : "FGF",
    form: profile.printer_type === "FDM" ? "filament" : "pellet",
    provider: null,
    base_chemistry: profile.id.startsWith("pla") ? "PLA" : null,
    nominal_hardness: null,
    source_status: "verified",
    sds_url: null,
    science: { operational_profile_seed: profile.id },
    is_active: true,
  }));
  const result = reconcile([profileRows, fgf, sds]);
  const report = {
    dry_run: dryRun,
    sources: { profiles: profiles.length, fgf: fgf.length, sds: sds.length },
    merged: result.merged,
    output: result.rows.length,
  };
  if (!dryRun) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error(
        "Live import requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await client
      .from("materials")
      .upsert(result.rows, { onConflict: "slug" })
      .select("id,slug");
    if (error) throw error;
    const ids = new Map(data.map((row) => [row.slug, row.id]));
    for (const profile of profiles) {
      const { error: bindError } = await client
        .from("material_profiles")
        .update({ material_id: ids.get(slugify(profile.id)) })
        .eq("id", profile.id);
      if (bindError) throw bindError;
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
