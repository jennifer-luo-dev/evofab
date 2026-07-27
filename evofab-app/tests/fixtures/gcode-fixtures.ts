function featureLine(type: string) {
  return `;TYPE:${type}`;
}

function square(
  lines: string[],
  e: { value: number },
  min: number,
  max: number,
) {
  lines.push(`G0 X${min} Y${min}`);
  for (const [x, y] of [
    [max, min],
    [max, max],
    [min, max],
    [min, min],
  ]) {
    e.value += 1;
    lines.push(`G1 X${x} Y${y} E${e.value.toFixed(3)}`);
  }
}

/**
 * Synthetic deterministic 20 mm parser/renderer fixture. It is not output
 * from an STL slicer and must never be used as source-to-toolpath evidence.
 */
export function cube20mmGcode(): string {
  const lines = [
    "; deterministic 20 mm cube",
    "START_PRINT",
    "M82",
    "SET_PRINT_STATS_INFO TOTAL_LAYER=21",
  ];
  const e = { value: 0 };
  for (let layer = 0; layer < 21; layer += 1) {
    const z = layer === 0 ? 0.2 : layer;
    lines.push(
      `;LAYER:${layer}`,
      `G0 Z${z.toFixed(2)}`,
      featureLine(layer === 20 ? "Top surface" : "Outer wall"),
    );
    square(lines, e, 0, 20);
    lines.push(featureLine("Sparse infill"));
    for (const y of [4, 8, 12, 16]) {
      lines.push(`G0 X0 Y${y}`);
      e.value += 1;
      lines.push(`G1 X20 Y${y} E${e.value.toFixed(3)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function supportHeavyGcode(): string {
  const lines = [
    "; deterministic support fixture",
    "START_PRINT",
    "M82",
    "SET_PRINT_STATS_INFO TOTAL_LAYER=12",
  ];
  const e = { value: 0 };
  for (let layer = 0; layer < 12; layer += 1) {
    const z = 0.2 + layer * 1.8;
    lines.push(`;LAYER:${layer}`, `G0 Z${z.toFixed(2)}`);
    if (layer < 9) {
      lines.push(featureLine("Support"));
      square(lines, e, 0, 8);
    }
    lines.push(featureLine("Outer wall"));
    square(lines, e, 10, 30);
    lines.push(featureLine("Sparse infill"));
    for (const x of [13, 17, 21, 25]) {
      lines.push(`G0 X${x} Y10`);
      e.value += 1;
      lines.push(`G1 X${x} Y30 E${e.value.toFixed(3)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export const SPARSE_GCODE =
  "START_PRINT\n;LAYER:0\nG1 Z0.2\n;TYPE:Outer wall\nG1 X0 Y0\nG1 X1 Y0 E1\n";

/**
 * This deliberately passes the former predicate: three reported/parsed layers,
 * non-empty representative samples, and more than 10 mm of extrusion. It is
 * only one diagonal string per layer, so the scale-aware density guard must
 * block it despite its START_PRINT and wall label.
 */
export const SPARSE_MULTILAYER_STRING_GCODE = [
  "START_PRINT",
  "M82",
  "SET_PRINT_STATS_INFO TOTAL_LAYER=3",
  ";LAYER:0",
  "G0 Z0.2",
  ";TYPE:Outer wall",
  "G0 X0 Y0",
  "G1 X20 Y20 E1",
  ";LAYER:1",
  "G0 Z0.4",
  "G0 X0 Y0",
  "G1 X20 Y20 E2",
  ";LAYER:2",
  "G0 Z0.6",
  "G0 X0 Y0",
  "G1 X20 Y20 E3",
  "",
].join("\n");
