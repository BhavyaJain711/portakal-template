import { describe, expect, it } from "vitest";
import { validateTemplate, extractPlaceholders } from "../src/index.js";
import type { TemplateSchema } from "../src/index.js";

const allowed = [
  { key: "store.name", label: "Store Name" },
  { key: "order.number", label: "Order Number" },
  { key: "order.time", label: "Order Time" },
  { key: "order.id", label: "Order ID" },
  { key: "order.total", label: "Order Total" },
];

const orderTemplate: TemplateSchema = {
  id: "order_label",
  rows: [
    { heightPercent: 20, cells: [{ widthPercent: 100, element: { type: "text", content: "{{store.name}}", align: "center", bold: true } }] },
    { heightPercent: 5, cells: [{ widthPercent: 100, element: { type: "line", thickness: 2 } }] },
    { heightPercent: 15, cells: [{ widthPercent: 60, element: { type: "text", content: "Order #{{order.number}}", bold: true } }, { widthPercent: 40, element: { type: "text", content: "{{order.time}}", align: "right" } }] },
    { heightPercent: 35, cells: [{ widthPercent: 100, element: { type: "barcode", content: "{{order.number}}", showText: true } }] },
    { heightPercent: 25, cells: [{ widthPercent: 30, element: { type: "qrcode", content: "https://ordyn.app/o/{{order.id}}" } }, { widthPercent: 70, element: { type: "box", thickness: 2, child: { type: "text", content: "TOTAL: ${{order.total}}", align: "center", bold: true } } }] },
  ],
};

describe("validateTemplate", () => {
  it("accepts the order label with matching allowed variables", () => {
    const result = validateTemplate(orderTemplate, { allowedVariables: allowed });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("accepts without allowedVariables (schema-only check)", () => {
    const result = validateTemplate(orderTemplate);
    expect(result.valid).toBe(true);
  });

  it("flags a placeholder not in the allowed list with an exact path", () => {
    const allowedMinusTotal = allowed.filter((v) => v.key !== "order.total");
    const result = validateTemplate(orderTemplate, { allowedVariables: allowedMinusTotal });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: "rows[4].cells[1].element.child",
        message: '"{{order.total}}" is not an allowed variable',
        level: "error",
      }),
    ]);
  });

  it("flags a repeat key not in the allowed list", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 50,
          repeat: "parts.name",
          cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}}" } }],
        },
      ],
    };
    const result = validateTemplate(template, { allowedVariables: [{ key: "design.number" }] });
    expect(result.valid).toBe(false);
    // Both the repeat key and the cell's {{name}} placeholder are disallowed.
    expect(result.errors).toEqual([
      expect.objectContaining({ path: "rows[0].repeat", message: '"parts.name" is not an allowed variable' }),
      expect.objectContaining({ path: "rows[0].cells[0].element", message: '"{{name}}" is not an allowed variable' }),
    ]);
  });

  it("reports row-width sums that don't reach 100", () => {
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
    const result = validateTemplate(bad);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ path: "rows[0].cells", message: "row widths sum to 80, expected ~100" }),
    ]);
  });

  it("reports static row heights that don't sum to 100", () => {
    const bad: TemplateSchema = {
      rows: [
        { heightPercent: 50, cells: [{ widthPercent: 100, element: { type: "space" } }] },
        { heightPercent: 20, cells: [{ widthPercent: 100, element: { type: "space" } }] },
      ],
    };
    const result = validateTemplate(bad);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ path: "rows", message: "row heights sum to 70, expected ~100" }),
    ]);
  });

  it("skips the height-sum check when a repeat row exists (rescaled at compile)", () => {
    const template: TemplateSchema = {
      rows: [
        { heightPercent: 40, cells: [{ widthPercent: 100, element: { type: "space" } }] },
        {
          heightPercent: 30,
          repeat: "parts",
          cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}}" } }],
        },
      ],
    };
    const result = validateTemplate(template, { allowedVariables: [{ key: "parts" }, { key: "name" }] });
    expect(result.valid).toBe(true);
  });

  it("reports unknown element type, missing content, and empty text", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [
            { widthPercent: 50, element: { type: "text", content: "" } as any },
            { widthPercent: 50, element: { type: "hologram" } as any },
          ],
        },
      ],
    };
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('unknown element type "hologram"'))).toBe(true);
    expect(result.warnings.some((e) => e.message.includes("text content is empty"))).toBe(true);
  });

  it("validates enums for align/ecc/orientation and image src", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [
            { widthPercent: 25, element: { type: "text", content: "x", align: "diagonal" } as any },
            { widthPercent: 25, element: { type: "qrcode", content: "y", ecc: "Z" } as any },
            { widthPercent: 25, element: { type: "line", orientation: "skew" } as any },
            { widthPercent: 25, element: { type: "image" } as any },
          ],
        },
      ],
    };
    const result = validateTemplate(template);
    const messages = result.errors.map((e) => e.message);
    expect(messages).toContain('invalid align "diagonal" (expected left|center|right)');
    expect(messages).toContain('invalid ecc "Z" (expected L|M|Q|H)');
    expect(messages).toContain('invalid orientation "skew" (expected horizontal|vertical)');
    expect(messages).toContain('image src must be a string like "width,height,byte,..."');
  });

  it("returns empty rows error when the template has no rows", () => {
    const result = validateTemplate({ rows: [] } as TemplateSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { path: "rows", message: "template must have at least one row", level: "error" },
    ]);
  });

  it("accepts item-scoped placeholders in a repeat row", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 50,
          repeat: "order.items",
          cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}} x{{qty}}" } }],
        },
      ],
    };
    // The repeat key AND the item fields (as order.items.name / order.items.qty) are allowed.
    const result = validateTemplate(template, {
      allowedVariables: [
        { key: "order.items" },
        { key: "order.items.name" },
        { key: "order.items.qty" },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts {{this}} in a repeat row (array of strings)", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 50,
          repeat: "toppings",
          cells: [{ widthPercent: 100, element: { type: "text", content: "- {{this}}" } }],
        },
      ],
    };
    const result = validateTemplate(template, {
      allowedVariables: [{ key: "toppings" }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("still flags a repeat-row placeholder with no matching item field", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 50,
          repeat: "order.items",
          cells: [{ widthPercent: 100, element: { type: "text", content: "{{bogus}}" } }],
        },
      ],
    };
    const result = validateTemplate(template, {
      allowedVariables: [{ key: "order.items" }, { key: "order.items.name" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ message: '"{{bogus}}" is not an allowed variable' }),
    ]);
  });

  it("warns on a stray {{ without a closing }}", () => {
    const template: TemplateSchema = {
      rows: [
        {
          heightPercent: 100,
          cells: [{ widthPercent: 100, element: { type: "text", content: "hello {{oops" } }],
        },
      ],
    };
    const result = validateTemplate(template);
    expect(result.warnings.some((w) => w.message.includes('stray "{{"'))).toBe(true);
  });
});

describe("extractPlaceholders", () => {
  it("finds and dedupes placeholder keys", () => {
    expect(extractPlaceholders("{{a.b}} and {{a.b}} and {{ c }}")).toEqual(["a.b", "c"]);
  });
  it("returns empty for text without placeholders", () => {
    expect(extractPlaceholders("plain text")).toEqual([]);
  });
});
