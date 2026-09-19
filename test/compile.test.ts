import { describe, expect, it } from "vitest";
import { toMonochromeBitmap } from "portakal-lite";
import { bitmapToDescriptor, compileTemplate, TemplateError } from "../src/index.js";
import type { TemplateSchema } from "../src/index.js";

/** Decode Uint8Array to string for text-command assertions. */
const decode = (buf: Uint8Array): string => new TextDecoder().decode(buf);

const orderTemplate: TemplateSchema = {
  id: "order_label",
  name: "Order Label",
  rows: [
    { heightPercent: 20, cells: [{ widthPercent: 100, element: { type: "text", content: "{{store.name}}", align: "center", bold: true } }] },
    { heightPercent: 5, cells: [{ widthPercent: 100, element: { type: "line", thickness: 2 } }] },
    { heightPercent: 15, cells: [{ widthPercent: 60, element: { type: "text", content: "Order #{{order.number}}", bold: true } }, { widthPercent: 40, element: { type: "text", content: "{{order.time}}", align: "right" } }] },
    { heightPercent: 35, cells: [{ widthPercent: 100, element: { type: "barcode", content: "{{order.number}}", showText: true } }] },
    { heightPercent: 25, cells: [{ widthPercent: 30, element: { type: "qrcode", content: "https://ordyn.app/o/{{order.id}}" } }, { widthPercent: 70, element: { type: "box", thickness: 2, child: { type: "text", content: "TOTAL: ${{order.total}}", align: "center", bold: true } } }] },
  ],
};

const data = {
  store: { name: "Acme Store" },
  order: { number: "1024", id: "abc123", time: "14:30", total: "29.48" },
};

const spec = { width: 65, height: 40, unit: "mm" as const, dpi: 203 };

describe("compileTemplate", () => {
  it("compiles to TSC with interpolated content", () => {
    const result = compileTemplate(orderTemplate, data, { spec });
    // Text uses plain TEXT commands (no BLOCK) for broad printer support.
    const tsc = decode(result.tsc);
    expect(tsc).toContain("TEXT ");
    expect(tsc).toContain("Acme Store");
    expect(tsc).toContain("Order #1024");
    expect(tsc).toMatch(/BARCODE \d+,\d+,"128",/);
    expect(tsc).toContain("TOTAL: $29.48");
  });

  it("compiles to ZPL with ^FD escaped content", () => {
    const result = compileTemplate(orderTemplate, data, { spec });
    expect(result.zpl).toContain("^XA");
    expect(result.zpl).toContain("^FD");
    expect(result.zpl).toContain("^BC"); // native code128
    expect(result.zpl).toContain("^BQ"); // native qr
    expect(result.zpl).toContain("^GB"); // box
  });

  it("produces an SVG preview", () => {
    const result = compileTemplate(orderTemplate, data, { spec });
    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("Acme Store");
  });

  it("reports resolved layout", () => {
    const result = compileTemplate(orderTemplate, data, { spec });
    expect(result.layout.cells).toHaveLength(7); // 1+1+2+1+2
  });

  it("applies row textScale to the TSC/ZPL X multiplier (height fixed)", () => {
    const scaled: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          textScale: 2,
          cells: [{ widthPercent: 100, element: { type: "text", content: "Hi", font: "0" } }],
        },
      ],
    };
    const base = compileTemplate({ rows: [{ heightPercent: 100, cells: [{ widthPercent: 100, element: { type: "text", content: "Hi", font: "0" } }] }] }, {}, { spec });
    const result = compileTemplate(scaled, {}, { spec });
    // TSC: font "0" TEXT x,y,"0",rot,xMul,yMul — xMul doubles, yMul stays.
    const baseTsc = decode(base.tsc).match(/TEXT (\d+),(\d+),"0",(\d+),(\d+),(\d+),/);
    const scaledTsc = decode(result.tsc).match(/TEXT (\d+),(\d+),"0",(\d+),(\d+),(\d+),/);
    expect(scaledTsc![4]).toBe(String(Number(baseTsc![4]) * 2)); // xMul
    expect(scaledTsc![5]).toBe(baseTsc![5]); // yMul fixed
    // ZPL: ^A0R,h,w — w doubles, h stays.
    const baseZ = base.zpl.match(/\^A0[RNI]?,(\d+),(\d+)/);
    const scaledZ = result.zpl.match(/\^A0[RNI]?,(\d+),(\d+)/);
    expect(scaledZ![2]).toBe(String(Number(baseZ![2]) * 2)); // w
    expect(scaledZ![1]).toBe(baseZ![1]); // h fixed
  });

  it("emits fixed fonts 1-8 with multiplier sizes (not points)", () => {
    const fixed: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [{ widthPercent: 100, element: { type: "text", content: "Hi", font: "3" } }],
        },
      ],
    };
    const result = compileTemplate(fixed, {}, { spec });
    const tsc = decode(result.tsc);
    // 40mm label @203dpi = 320 dots tall; font "3" base 16×24 → y-mul = floor(320×0.95/24) = 12, capped at 10.
    // xSize for "Hi" (2 chars, 519 wide) raw = floor(519/2/16) = 16 → capped at 2×10 = 20 → 16.
    const m = tsc.match(/TEXT (\d+),(\d+),"3",(\d+),(\d+),(\d+),/);
    expect(m).toBeTruthy();
    expect(Number(m![4])).toBeGreaterThanOrEqual(1); // xMul
    expect(Number(m![5])).toBeLessThanOrEqual(10); // yMul ≤ 10
    expect(tsc).toContain('"3"');
    // ZPL: ^A3 uses base 16×24, so h = yMul×24, w = xMul×16 (not 12).
    expect(result.zpl).toMatch(/\^A3N,\d+,\d+/);
  });

  it("respects fontScale cap on fixed fonts in compiled output", () => {
    const capped: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [{ widthPercent: 100, element: { type: "text", content: "Hi", font: "3", fontScale: 2 } }],
        },
      ],
    };
    const result = compileTemplate(capped, {}, { spec });
    const m = decode(result.tsc).match(/TEXT (\d+),(\d+),"3",(\d+),(\d+),(\d+),/);
    expect(m).toBeTruthy();
    expect(Number(m![5])).toBe(2); // yMul capped by fontScale
  });

  it("throws on missing data key", () => {
    const bad = { ...data, order: { ...data.order, number: undefined } } as unknown as typeof data;
    expect(() => compileTemplate(orderTemplate, bad, { spec })).toThrow(TemplateError);
  });

  it("auto-normalizes row heights that don't sum to 100 (repeat scaling)", () => {
    const single: TemplateSchema = {
      rows: [{ heightPercent: 50, cells: [{ widthPercent: 100, element: { type: "space" } }] }],
    };
    // A single 50% row scales up to fill the label.
    const result = compileTemplate(single, {}, { spec });
    expect(result.layout.heightDots).toBe(320);
    expect(result.layout.cells[0]!.height).toBeGreaterThan(100);

    // Cell widths are still validated (no auto-fix there).
    const bad: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [
            { widthPercent: 60, element: { type: "space" } },
            { widthPercent: 20, element: { type: "space" } },
          ],
        },
      ],
    };
    expect(() => compileTemplate(bad, {}, { spec })).toThrow(/widths sum/);
  });

  it("escapes hostile data in ZPL output (injection-safe)", () => {
    const hostile = {
      store: { name: "Acme^FS^XA^FDBOOM^XZ" },
      order: { number: "1024", id: "abc", time: "14:30", total: "29.48" },
    };
    const result = compileTemplate(orderTemplate, hostile, { spec });
    // The ^FH_ escape means no raw "^FS^XA" appears in the ^FD payload
    expect(result.zpl).not.toContain("^FD^FS^XA");
    expect(result.zpl).not.toContain("^FDBOOM");
  });

  it("wires gap through to TSC GAP and ZPL", () => {
    const result = compileTemplate(orderTemplate, data, { spec: { ...spec, gap: 5 } });
    // TSC GAP in mm (5mm @203dpi = 40 dots → 40/203*25.4 ≈ 5mm)
    expect(decode(result.tsc)).toContain("GAP 5 mm,0 mm");
    // ZPL has no GAP; ensure the label still compiles with the gap set
    expect(result.zpl).toContain("^XA");
  });

  it("applies a spec margin to the layout and emits ZPL ^ML", () => {
    const result = compileTemplate(orderTemplate, data, { spec: { ...spec, margin: 2 } });
    // Content is inset by 2mm (16 dots) on all sides
    expect(result.layout.cells[0]!.x).toBe(18); // 16 margin + 2 padding
    expect(result.layout.cells[0]!.y).toBe(18);
    // ZPL ^ML in dots (2mm @203dpi = 16 dots)
    expect(result.zpl).toContain("^ML16");
    // TSC has no margin command — the layout inset is the mechanism
  });

  it("returns a display string alongside the binary TSC stream", () => {
    const result = compileTemplate(orderTemplate, data, { spec });

    // tscText is showable: the commands are there and nothing is mojibake.
    expect(result.tscText).toContain("Acme Store");
    expect(result.tscText).toContain("CLS");
    expect(result.tscText).toContain("PRINT 1");
    expect(result.tscText).not.toContain("\uFFFD");
  });

  it("elides the bitmap payload in tscText while keeping the bytes in tsc", () => {
    // 16×16 fully dark → 2 bytes per row × 16 = 32 packed bytes of 0xFF.
    const bitmap = toMonochromeBitmap(new Uint8Array(16 * 16), 16, 16);
    const schema: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [{ widthPercent: 100, element: { type: "image", src: bitmapToDescriptor(bitmap) } }],
        },
      ],
    };

    const result = compileTemplate(schema, {}, { spec: { width: 40, height: 20, unit: "mm", dpi: 203 } });

    expect(result.tscText).toContain("<32 bytes of bitmap data>");
    expect(result.tscText).toContain("PRINT 1");
    expect(result.tscText).not.toContain("\uFFFD");
    // The wire stream still carries the raw pixel bytes.
    expect(Array.from(result.tsc)).toContain(0xff);
  });
});

describe("device-agnostic templates", () => {
  it("adapts to a different label size without changing the template", () => {
    const small = compileTemplate(orderTemplate, data, { spec: { width: 30, height: 20, unit: "mm", dpi: 203 } });
    const large = compileTemplate(orderTemplate, data, { spec: { width: 120, height: 80, unit: "mm", dpi: 300 } });
    // Both valid, different coordinates
    expect(decode(small.tsc)).toContain("SIZE 30 mm");
    expect(decode(large.tsc)).toContain("SIZE 120 mm");
    expect(small.layout.widthDots).toBe(240);
    expect(large.layout.widthDots).toBe(1417); // 120mm @300dpi
  });

  it("repeats over an array of strings via {{this}}", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          repeat: "toppings",
          cells: [{ widthPercent: 100, element: { type: "text", content: "- {{this}}" } }],
        },
      ],
    };
    const result = compileTemplate(template, { toppings: ["Cheese", "Pepperoni", "Olives"] }, { spec });
    const tsc = decode(result.tsc);
    expect(tsc).toContain("- Cheese");
    expect(tsc).toContain("- Pepperoni");
    expect(tsc).toContain("- Olives");
    expect(result.layout.cells).toHaveLength(3);
  });

  it("still supports object items by field", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          repeat: "parts",
          cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}}" } }],
        },
      ],
    };
    const result = compileTemplate(template, { parts: [{ name: "A" }, { name: "B" }] }, { spec });
    const tsc = decode(result.tsc);
    expect(tsc).toContain("A");
    expect(tsc).toContain("B");
  });
});

describe("column element (stacked elements in one cell)", () => {
  // 65×40mm @203dpi = 520×320 dots; padding 2 → the single cell is 2,2 516×316.
  const textY = (tsc: Uint8Array, content: string): number => {
    const str = decode(tsc);
    const m = str.match(new RegExp(`TEXT (\\d+),(\\d+),"[^"]*",\\d+,\\d+,\\d+,"${content}"`));
    expect(m, `no TEXT command for "${content}"`).toBeTruthy();
    return Number(m![2]);
  };

  const column = (items: { heightPercent: number; content: string }[]): TemplateSchema => ({
    rows: [
      {
        heightPercent: 100,
        cells: [
          {
            widthPercent: 100,
            element: {
              type: "column",
              items: items.map((i) => ({
                heightPercent: i.heightPercent,
                element: { type: "text", content: i.content },
              })),
            },
          },
        ],
      },
    ],
  });

  it("stacks items down the cell", () => {
    const result = compileTemplate(column([
      { heightPercent: 50, content: "Top" },
      { heightPercent: 50, content: "Bottom" },
    ]), {}, { spec });

    // Cell runs y=2..318; a 50/50 split puts the second item at the midpoint.
    expect(textY(result.tsc, "Top")).toBe(2);
    expect(textY(result.tsc, "Bottom")).toBe(160);
  });

  it("tiles the cell exactly with no gaps (odd percentages)", () => {
    const result = compileTemplate(column([
      { heightPercent: 33, content: "One" },
      { heightPercent: 33, content: "Two" },
      { heightPercent: 34, content: "Three" },
    ]), {}, { spec });

    // Boundaries round once each: 2, 106, 211, 318 — the last hits the cell bottom.
    expect([textY(result.tsc, "One"), textY(result.tsc, "Two"), textY(result.tsc, "Three")])
      .toEqual([2, 106, 211]);
  });

  it("interpolates placeholders inside items", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [
            {
              widthPercent: 100,
              element: {
                type: "column",
                items: [
                  { heightPercent: 100, element: { type: "text", content: "{{store.name}}" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = compileTemplate(template, data, { spec });
    // The stack gets the full label height, so it has one row per column item;
    // the interpolated value wraps, hence checking both words.
    const tsc = decode(result.tsc);
    expect(tsc).not.toContain("{{");
    expect(tsc).toContain("Acme");
    expect(tsc).toContain("Store");
  });

  it("resolves item placeholders against a repeat row's item", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          repeat: "parts",
          cells: [
            {
              widthPercent: 100,
              element: {
                type: "column",
                items: [
                  { heightPercent: 50, element: { type: "text", content: "{{name}}" } },
                  { heightPercent: 50, element: { type: "text", content: "{{sku}}" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = compileTemplate(template, { parts: [{ name: "Widget", sku: "W-1" }] }, { spec });
    const tsc = decode(result.tsc);
    expect(tsc).toContain("Widget");
    expect(tsc).toContain("W-1");
  });

  it("nests a column inside a column", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [
            {
              widthPercent: 100,
              element: {
                type: "column",
                items: [
                  { heightPercent: 50, element: { type: "text", content: "Head" } },
                  {
                    heightPercent: 50,
                    element: {
                      type: "column",
                      items: [
                        { heightPercent: 50, element: { type: "text", content: "InnerA" } },
                        { heightPercent: 50, element: { type: "text", content: "InnerB" } },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = compileTemplate(template, {}, { spec });
    // Outer split at 160; the inner column then splits 160..318 at 239.
    expect(textY(result.tsc, "Head")).toBe(2);
    expect(textY(result.tsc, "InnerA")).toBe(160);
    expect(textY(result.tsc, "InnerB")).toBe(239);
  });

  it("throws when item heights don't sum to 100", () => {
    expect(() => compileTemplate(column([
      { heightPercent: 50, content: "A" },
      { heightPercent: 40, content: "B" },
    ]), {}, { spec })).toThrow(/item heights sum to 90/);
  });

  it("throws on an empty column", () => {
    const empty: TemplateSchema = {
      rows: [{ heightPercent: 100, cells: [{ widthPercent: 100, element: { type: "column", items: [] } }] }],
    };
    expect(() => compileTemplate(empty, {}, { spec })).toThrow(/at least one item/);
  });
});
