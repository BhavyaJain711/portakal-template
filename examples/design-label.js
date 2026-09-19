#!/usr/bin/env node
/**
 * Design label example — a design number, a CUT value, and dynamic rows
 * (one per part, from an array in the data). Same template renders at any
 * label size via the PrintSpec.
 */
import { compileTemplate } from "../dist/index.mjs";

const designTemplate = {
  id: "ordyn_design_label_v1",
  name: "Design Label with Cut Value and Parts",
  padding: 2,
  rows: [
    {
      // Design number — prominent, centered.
      heightPercent: 30,
      cells: [
        {
          widthPercent: 100,
          element: { type: "text", content: "Design No. {{design.number}}", align: "center", bold: true },
        },
      ],
    },
    {
      // Cut length — centered below the design number. Uses fixed font "3"
      // (16×24 dots) at the auto-computed multiplier instead of scalable "0".
      heightPercent: 20,
      cells: [
        {
          widthPercent: 100,
          element: { type: "text", content: "CUT: {{design.cut}} m", align: "center", bold: true, font: "3" },
        },
      ],
    },
    {
      heightPercent: 5,
      cells: [{ widthPercent: 100, element: { type: "line", thickness: 2 } }],
    },
    {
      // Dynamic rows: one per part. Each part row gets the full share; the
      // engine scales all rows down proportionally so they sum to 100%.
      heightPercent: 20,
      repeat: "design.parts",
      cells: [
        {
          widthPercent: 100,
          // A `column` stacks several elements in one cell: here the part name
          // over its size. Item heights are percentages of the cell height.
          element: {
            type: "column",
            items: [
              { heightPercent: 60, element: { type: "text", content: "{{name}}", align: "center" } },
              { heightPercent: 40, element: { type: "text", content: "{{size}}", align: "center" } },
            ],
          },
        },
      ],
    },
  ],
};

const data = {
  design: {
    number: "14301",
    id: "d1042",
    cut: "9.00",
    parts: [
      { name: "Back Work", size: "1200 mm" },
      { name: "Sleeve Work", size: "1200 mm" },
      { name: "Bottom Work", size: "600 mm" },
    ],
  },
};

const spec = { width: 65, height: 40, unit: "mm", dpi: 203, font0Mode: "points", margin: 2, gap: 3, charWidthFactor: 0.5, direction: 1 };

const result = compileTemplate(designTemplate, data, { spec });

console.log("=== TSC (TSPL2) — 65×40mm @203dpi ===");
console.log(result.tsc);
console.log("\n=== ZPL II ===");
console.log(result.zpl);

// Device-agnostic: same template on a taller label to fit more parts.
const tall = compileTemplate(designTemplate, data, {
  spec: { width: 65, height: 60, unit: "mm", dpi: 203, font0Mode: "points", margin: 3 },
});
console.log("\n=== Same template on a 65×60mm label (first 4 TEXT lines) ===");
console.log(tall.tsc.split("\n").filter((l) => l.startsWith("TEXT")).slice(0, 4).join("\n"));

