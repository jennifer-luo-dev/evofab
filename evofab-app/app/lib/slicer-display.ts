export function displaySlicerEngine(engine: string | null | undefined): string {
  if (!engine) return "—";
  return engine.replaceAll("GingerSlicer", "OrcaSlicer");
}
