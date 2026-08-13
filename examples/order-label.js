#!/usr/bin/env node
/**
 * Order label example — the plan's template schema, compiled with a PrintSpec
 * supplied at print time. The same template renders at any label size.
 */
import { compileTemplate } from "../dist/index.js";

const orderTemplate = {
  id: "ordyn_order_label_v2",
  name: "Order Label with Barcode",
  padding: 2,
  rows: [
    {
      heightPercent: 20,
      cells: [
        {
          widthPercent: 100,
          element: { type: "text", content: "{{store.name}}", align: "center", bold: true },
        },
      ],
    },
    {
      heightPercent: 5,
      cells: [{ widthPercent: 100, element: { type: "line", thickness: 2 } }],
    },
    {
      heightPercent: 15,
      cells: [
        { widthPercent: 60, element: { type: "text", content: "Order #{{order.number}}", bold: true } },
        { widthPercent: 40, element: { type: "text", content: "{{order.time}}", align: "right" } },
      ],
    },
    {
      heightPercent: 35,
      cells: [
        { widthPercent: 100, element: { type: "barcode", content: "{{order.number}}", showText: true } },
      ],
    },
    {
      heightPercent: 25,
      cells: [
        { widthPercent: 30, element: { type: "qrcode", content: "https://ordyn.app/o/{{order.id}}" } },
        {
          widthPercent: 70,
          element: {
            type: "box",
            thickness: 2,
            child: { type: "text", content: "TOTAL: ${{order.total}}", align: "center", bold: true },
          },
        },
      ],
    },
  ],
};

const data = {
  store: { name: "Acme Store" },
  order: { number: "1024", id: "abc123", time: "14:30", total: "29.48" },
};

const spec = { width: 65, height: 40, unit: "mm", dpi: 203, font0Mode: "points" };

const result = compileTemplate(orderTemplate, data, { spec });

console.log("=== TSC (TSPL2) — 60×40mm @203dpi ===");
console.log(result.tsc);
console.log("\n=== ZPL II — 60×40mm @203dpi ===");
console.log(result.zpl);

// Device-agnostic: same template, different print size.
const wide = compileTemplate(orderTemplate, data, { spec: { width: 100, height: 50, unit: "mm", dpi: 203 } });
console.log("\n=== Same template on a 100×50mm label (TSC header) ===");
console.log(wide.tsc.split("\r\n").slice(0, 4).join("\r\n"));
