import { describe, expect, it } from "vitest";
import { layoutTemplate, toDots, validatePercentages, TemplateError } from "../src/index.js";
import type { ResolvedTemplate, TemplateSchema } from "../src/index.js";

const spec = { width: 60, height: 40, unit: "mm" as const, dpi: 203 };
// 60mm @203dpi = 480 dots, 40mm = 320 dots

function resolvedFrom(schema: TemplateSchema, data: Record<string, unknown>): ResolvedTemplate {
  // minimal resolver for layout tests (avoid importing heavy templating)
  const rows = schema.rows.map((r) => ({
    heightPercent: r.heightPercent,
    cells: r.cells.map((c) => ({
      widthPercent: c.widthPercent,
      element: c.element,
    })),
  }));
  return { data, rows };
}

describe("toDots", () => {
  it("converts mm to dots at 203 dpi", () => {
    expect(toDots(60, "mm", 203)).toBe(480);
    expect(toDots(40, "mm", 203)).toBe(320);
  });

  it("converts inch and dot units", () => {
    expect(toDots(1, "inch", 203)).toBe(203);
    expect(toDots(100, "dot", 203)).toBe(100);
  });

  it("rejects non-positive values", () => {
    expect(() => toDots(0, "mm", 203)).toThrow(TemplateError);
  });
});

describe("validatePercentages", () => {
  it("accepts rows summing to 100", () => {
    const rows = [
      { heightPercent: 50, cells: [{ widthPercent: 100, element: { type: "space" as const } }] },
      { heightPercent: 50, cells: [{ widthPercent: 100, element: { type: "space" as const } }] },
    ];
    expect(() => validatePercentages(rows)).not.toThrow();
  });

  it("rejects rows not summing to ~100", () => {
    const rows = [
      { heightPercent: 30, cells: [{ widthPercent: 100, element: { type: "space" as const } }] },
      { heightPercent: 30, cells: [{ widthPercent: 100, element: { type: "space" as const } }] },
    ];
    expect(() => validatePercentages(rows)).toThrow(/sum/);
  });

  it("rejects cell widths not summing to ~100", () => {
    const rows = [
      {
        heightPercent: 100,
        cells: [
          { widthPercent: 60, element: { type: "space" as const } },
          { widthPercent: 20, element: { type: "space" as const } },
        ],
      },
    ];
    expect(() => validatePercentages(rows)).toThrow(/widths sum/);
  });
});

describe("layoutTemplate", () => {
  it("computes row/cell dot bounds from percentages", () => {
    const template: TemplateSchema = {
      rows: [
        { heightPercent: 20, cells: [{ widthPercent: 100, element: { type: "space" } }] },
        {
          heightPercent: 80,
          cells: [
            { widthPercent: 30, element: { type: "space" } },
            { widthPercent: 70, element: { type: "space" } },
          ],
        },
      ],
    };
    const resolved = resolvedFrom(template, {});
    const layout = layoutTemplate(resolved, spec, 2);
    expect(layout.widthDots).toBe(480);
    expect(layout.heightDots).toBe(320);
    // Row 1: 20% = 64 dots tall, full width
    expect(layout.cells[0]).toEqual({ x: 2, y: 2, width: 476, height: 60 });
    // Row 2: 80% = 256 dots; cell1 30% = 144 wide, cell2 70% = 336 wide
    expect(layout.cells[1]).toEqual({ x: 2, y: 66, width: 140, height: 252 });
    expect(layout.cells[2]).toEqual({ x: 146, y: 66, width: 332, height: 252 });
  });

  it("applies padding insets", () => {
    const template: TemplateSchema = {
      rows: [{ heightPercent: 100, cells: [{ widthPercent: 100, element: { type: "space" } }] }],
    };
    const resolved = resolvedFrom(template, {});
    const layout = layoutTemplate(resolved, spec, 10);
    expect(layout.cells[0]).toEqual({ x: 10, y: 10, width: 460, height: 300 });
  });

  it("insets the whole content area by the spec margin", () => {
    const template: TemplateSchema = {
      rows: [{ heightPercent: 100, cells: [{ widthPercent: 100, element: { type: "space" } }] }],
    };
    const resolved = resolvedFrom(template, {});
    // 2mm @203dpi ≈ 16 dots; content shrinks by 2×16 on each axis.
    const layout = layoutTemplate(resolved, { ...spec, margin: 2 }, 0);
    expect(layout.cells[0]).toEqual({ x: 16, y: 16, width: 448, height: 288 });
  });

  it("clamps an oversized margin so content never collapses", () => {
    const template: TemplateSchema = {
      rows: [{ heightPercent: 100, cells: [{ widthPercent: 100, element: { type: "space" } }] }],
    };
    const resolved = resolvedFrom(template, {});
    const layout = layoutTemplate(resolved, { ...spec, margin: 100 }, 0);
    expect(layout.cells[0].width).toBeGreaterThanOrEqual(1);
    expect(layout.cells[0].height).toBeGreaterThanOrEqual(1);
  });

  it("handles repeat-expanded rows (height per instance)", () => {
    const resolved: ResolvedTemplate = {
      data: {},
      rows: [
        { heightPercent: 50, cells: [{ widthPercent: 100, element: { type: "space" } }] },
        { heightPercent: 25, cells: [{ widthPercent: 100, element: { type: "space" } }] },
        { heightPercent: 25, cells: [{ widthPercent: 100, element: { type: "space" } }] },
      ],
    };
    const layout = layoutTemplate(resolved, spec, 0);
    expect(layout.cells[0].y).toBe(0);
    expect(layout.cells[1].y).toBe(160);
    expect(layout.cells[2].y).toBe(240);
  });
});
