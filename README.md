# portakal-template

Percentage-layout label templates on top of [portakal-lite](https://github.com/bhavyajain711/portakal-lite).
Declarative JSON template + data → TSC/TSPL2 + ZPL II printer-ready strings, with auto-scaling layout.

- **Device-agnostic** — the label size/DPI are supplied at compile time via `PrintSpec`, not stored in the template. One template adapts to any printer.
- **Percentage rows/cells** — no font sizes; the engine measures cell bounds and auto-scales text, barcodes, and QR codes to fit.
- **Repeat rows** — one row definition expands per array element, with proportional height scaling so fixed rows stay dominant.
- **Zero dependencies** (beyond portakal-lite, itself zero-dep beyond etiket). Pure ESM, TypeScript-first.
- **Validation** — `validateTemplate` checks structure, element config, and allowed variables, returning structured issues for UI builders and servers alike.

## Install

```sh
npm install portakal-template
```

## Quick start

```ts
import { compileTemplate, validateTemplate } from "portakal-template";

const orderTemplate = {
  id: "ordyn_order_label_v2",
  name: "Order Label",
  padding: 2,
  rows: [
    { heightPercent: 20, cells: [{ widthPercent: 100, element: { type: "text", content: "{{store.name}}", align: "center", bold: true } }] },
    { heightPercent: 5, cells: [{ widthPercent: 100, element: { type: "line", thickness: 2 } }] },
    { heightPercent: 15, cells: [
      { widthPercent: 60, element: { type: "text", content: "Order #{{order.number}}", bold: true } },
      { widthPercent: 40, element: { type: "text", content: "{{order.time}}", align: "right" } },
    ] },
    { heightPercent: 35, cells: [{ widthPercent: 100, element: { type: "barcode", content: "{{order.number}}", showText: true } }] },
    { heightPercent: 25, cells: [
      { widthPercent: 30, element: { type: "qrcode", content: "https://ordyn.app/o/{{order.id}}" } },
      { widthPercent: 70, element: { type: "box", thickness: 2, child: { type: "text", content: "TOTAL: ${{order.total}}", align: "center", bold: true } } },
    ] },
  ],
};

const data = {
  store: { name: "Acme Store" },
  order: { number: "1024", id: "abc123", time: "14:30", total: "29.48" },
};

// The template is device-agnostic — the printer spec is supplied at print time.
const spec = { width: 65, height: 40, unit: "mm", dpi: 203, font0Mode: "points" };

const result = compileTemplate(orderTemplate, data, { spec });

result.tsc;  // TSC/TSPL2 command string
result.zpl;  // ZPL II command string
result.svg;  // SVG preview string (the exact layout that prints)
result.layout; // resolved dot-space layout (debugging / custom use)
```

Send `result.tsc` or `result.zpl` to your printer over TCP (port 9100), USB, or a spooler — the package only produces the string.

## Template schema

A template is rows stacked top→down; each row is cells laid left→right.

| Field | Type | Notes |
|---|---|---|
| `rows[].heightPercent` | number | % of label height (e.g. 20 = 20%). Sums to ~100; repeat rows rescale the total. |
| `rows[].repeat` | string | Data key of an array. The row expands once per element; `{{...}}` resolves per element. Nested repeats unsupported. |
| `rows[].textScale` | number | Horizontal text stretch multiplier for all text in the row (default `1`, range `0.5`–`3`). Widens glyphs on the x-axis only — the row height (y-axis) and auto-computed font size stay fixed, like BarTender's width scaling. Repeat rows inherit it. |
| `rows[].cells[].widthPercent` | number | % of label width; must sum to ~100. |
| `rows[].cells[].element` | object | One of: `text`, `barcode`, `qrcode`, `line`, `box`, `image`, `space`. |

Element types:

- **text** — `content`, `font` (`"0"` default — scalable, or `"1"`–`"8"` fixed-pitch), `fontScale` (fixed fonts only, 1–10), `align` (`left|center|right`), `bold`, `reverse`, `wrap`, `charWidthFactor`
- **barcode** — `content`, `symbology` (`code128` default, `code39`, `ean13`, `upca`, …), `showText`
- **qrcode** — `content`, `ecc` (`L|M|Q|H`, default `M`)
- **line** — `thickness`, `orientation` (`horizontal|vertical`)
- **box** — `thickness`, `radius`, `child` (optional inner element)
- **image** — `src` as a 1-bit bitmap descriptor `"width,height,byte,byte,..."` (dots)
- **space** — blank

### Fonts

Text elements default to font `"0"` — the scalable TrueType font, sized in points
with independent X/Y scaling. Fonts `"1"`–`"8"` are the TSC fixed-pitch dot fonts,
sized as an integer **multiplier (1–10)** of their base dot size (the engine
auto-picks the largest multiplier that fits the cell; `fontScale` caps it):

| Font | Base size (dots) | Notes |
|---|---|---|
| `"0"` | scalable (points) | Monotype CG Triumvirate Bold Condensed |
| `"1"` | 8×12 | fixed pitch |
| `"2"` | 12×20 | fixed pitch |
| `"3"` | 16×24 | fixed pitch |
| `"4"` | 24×32 | fixed pitch |
| `"5"` | 32×48 | fixed pitch |
| `"6"` | 14×19 | OCR-B |
| `"7"` | 21×27 | OCR-B |
| `"8"` | 14×25 | OCR-A |

```json
{
  "type": "text",
  "content": "CUT: 9.00 m",
  "font": "3",
  "fontScale": 4,
  "align": "center"
}
```

`fontScale` (1–10) sets the maximum multiplier; omit it to let the engine fill
the cell height. It is ignored for font `"0"` (points-based).

The `PrintSpec` supplies `width`, `height`, `unit`, `dpi`, `gap`, `margin`, `speed`, `density`, `direction`, `copies`, `font0Mode`, `charWidthFactor`. See the type definition for details.

## Validation

`validateTemplate` checks the schema before anything reaches a printer. It never throws — it returns structured issues:

```ts
import { validateTemplate } from "portakal-template";

const result = validateTemplate(orderTemplate, {
  allowedVariables: [
    { key: "store.name", label: "Store Name" },
    { key: "order.number", label: "Order Number" },
    // ...every key the template may use
  ],
});

result.valid;    // boolean
result.errors;   // { path, message, level: "error" }[]
result.warnings; // { path, message, level: "warning" }[]
```

Checks:

- **Structure** — rows non-empty, heights positive; each row ≥1 cell; widths positive and summing to ~100; static row heights sum to ~100 (skipped when a repeat row exists — `resolveTemplate` rescales the expanded total).
- **Elements** — known type; required fields present (`text.content`, `barcode.content`, `qrcode.content`, `image.src`); valid `align`/`ecc`/`orientation`/`symbology`.
- **Variables** — every `{{path}}` must match an allowed key (including `repeat` keys and box children), with an exact `rows[i].cells[j].element`-style path on errors.
- **Warnings** — stray `{{` without closing, empty content.

## Repeat rows (dynamic line items)

A `repeat` row's `heightPercent` is the per-item budget. Every array element gets that full share; the engine then scales all rows down proportionally so the expanded total sums to 100% — fixed rows keep their relative weight, so a prominent design row stays dominant no matter how many items there are. Empty arrays expand to nothing.

```ts
const template = {
  rows: [
    { heightPercent: 40, cells: [{ widthPercent: 100, element: { type: "text", content: "Design No. {{design.number}}" } }] },
    { heightPercent: 30, repeat: "design.parts", cells: [{ widthPercent: 100, element: { type: "text", content: "{{name}}" } }] },
  ],
};
```

## Examples

Runnable examples live in [`examples/`](./examples) — build first (`npm run build`), then:

```sh
node examples/order-label.js      # the order-label template → TSC/ZPL + SVG
node examples/design-label.js     # design number + repeat part rows
```

## Related

- [portakal-lite](https://github.com/bhavyajain711/portakal-lite) — the fluent `label()` builder this compiles to (TSC + ZPL, SVG preview, receipt helpers)
- [portakal-template-builder-rn](https://github.com/bhavyajain711/portakal-template-builder-rn) — a React Native visual builder component on top of this package
- [etiket](https://github.com/productdevbook/etiket) — barcode/QR encoding

## License

MIT.
