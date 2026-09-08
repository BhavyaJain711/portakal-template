import { describe, expect, it } from "vitest";
import { interpolate, resolvePath, resolveTemplate, TemplateError } from "../src/index.js";
import type { TemplateSchema } from "../src/index.js";

describe("interpolate", () => {
  it("resolves simple and dotted placeholders", () => {
    expect(interpolate("Order #{{order.number}}", { order: { number: 1024 } })).toBe(
      "Order #1024",
    );
  });

  it("handles whitespace inside braces", () => {
    expect(interpolate("{{ a.b }}", { a: { b: "x" } })).toBe("x");
  });

  it("throws on missing key", () => {
    expect(() => interpolate("{{order.missing}}", { order: {} })).toThrow(TemplateError);
    expect(() => interpolate("{{order.missing}}", { order: {} })).toThrow(
      'missing template key "order.missing"',
    );
  });

  it("throws on empty placeholder", () => {
    expect(() => interpolate("a {{}} b", {})).toThrow(TemplateError);
  });

  it("throws when navigating through a non-object", () => {
    expect(() => interpolate("{{a.b}}", { a: 5 })).toThrow(TemplateError);
  });
});

describe("resolvePath", () => {
  it("reads nested values and arrays", () => {
    const data = { order: { items: [{ name: "cola" }] } };
    expect(resolvePath(data, "order.items.0.name")).toBe("cola");
  });
});

describe("resolveTemplate (repeat rows)", () => {
  const schema: TemplateSchema = {
    rows: [
      { heightPercent: 10, cells: [{ widthPercent: 100, element: { type: "text", content: "{{store.name}}" } }] },
      {
        heightPercent: 20,
        repeat: "order.items",
        cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}} x{{qty}}" } }],
      },
    ],
  };

  it("expands a repeat row once per array element", () => {
    const data = { store: { name: "Acme" }, order: { items: [{ name: "cola", qty: 2 }, { name: "fries", qty: 1 }] } };
    const resolved = resolveTemplate(schema, data);
    expect(resolved.rows).toHaveLength(3);
    expect(resolved.rows[0].cells[0]!.element).toMatchObject({ type: "text", content: "Acme" });
    expect(resolved.rows[1].cells[0]!.element).toMatchObject({ type: "text", content: "cola x2" });
    expect(resolved.rows[2].cells[0]!.element).toMatchObject({ type: "text", content: "fries x1" });
  });

  it("throws when repeat key is not an array", () => {
    const data = { store: {}, order: { items: "nope" } };
    expect(() => resolveTemplate(schema, data)).toThrow(TemplateError);
  });

  it("throws when repeat array contains a non-object", () => {
    const data = { store: { name: "Acme" }, order: { items: [1, 2] } };
    expect(() => resolveTemplate(schema, data)).toThrow(TemplateError);
  });

  it("empty repeat array produces no rows for that slot", () => {
    const data = { store: { name: "Acme" }, order: { items: [] } };
    const resolved = resolveTemplate(schema, data);
    expect(resolved.rows).toHaveLength(1);
  });

  it("repeat rows inherit textScale on every expanded row", () => {
    const s: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          repeat: "parts",
          textScale: 2,
          cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}}" } }],
        },
      ],
    };
    const resolved = resolveTemplate(s, { parts: [{ name: "A" }, { name: "B" }] });
    expect(resolved.rows).toHaveLength(2);
    expect(resolved.rows[0]!.textScale).toBe(2);
    expect(resolved.rows[1]!.textScale).toBe(2);
  });
});

describe("resolveTemplate (repeat budget scaling)", () => {
  it("keeps fixed rows' shares and splits the rest evenly", () => {
    const s: TemplateSchema = {
      rows: [
        { heightPercent: 40, cells: [{ widthPercent: 100, element: { type: "text", content: "#{{d.number}}" } }] },
        { heightPercent: 30, cells: [{ widthPercent: 100, element: { type: "text", content: "CUT: {{d.cut}}" } }] },
        {
          heightPercent: 30,
          repeat: "d.parts",
          cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}}" } }],
        },
      ],
    };
    // 1 part: 40+30+30 = 100, no scaling needed.
    const one = resolveTemplate(s, { d: { number: "1", cut: "9", parts: [{ name: "A" }] } });
    expect(one.rows.map((r) => Math.round(r.heightPercent))).toEqual([40, 30, 30]);
    // 3 parts: 40+30+90 = 160 → scale by 100/160 = 0.625.
    const three = resolveTemplate(s, { d: { number: "1", cut: "9", parts: [{ name: "A" }, { name: "B" }, { name: "C" }] } });
    const pcts = three.rows.map((r) => r.heightPercent);
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    expect(pcts[0]).toBeCloseTo(25, 5); // 40 × 0.625
    expect(pcts[1]).toBeCloseTo(18.75, 5);
    expect(pcts[2]).toBeCloseTo(18.75, 5); // each part
  });
});
