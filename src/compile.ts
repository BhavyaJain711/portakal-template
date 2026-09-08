/**
 * The bridge: resolve a template + data against a PrintSpec, build a
 * portakal-lite label (the IR), and compile to TSC/TSPL2 and ZPL II strings
 * (plus an SVG preview).
 *
 * All content flows through portakal-lite's hardened builder methods — this
 * package never emits raw printer commands.
 */

import {
  label,
  tsc as tscLang,
  zpl as zplLang,
  type LabelBuilder,
} from "portakal-lite";
import type {
  PrintSpec,
  ResolvedCell,
  ResolvedTemplate,
  TemplateSchema,
} from "./types.js";
import { resolveTemplate, TemplateError } from "./templating.js";
import { layoutTemplate, toDots, type Bounds, type Layout } from "./layout.js";
import { layoutText, scaleBarcode, scaleQr } from "./autoscale.js";

export interface CompileOptions {
  /** Physical print parameters (required — the template is device-agnostic). */
  spec: PrintSpec;
  /** Cell padding in dots (default 2, or template `padding`). */
  padding?: number;
  /** Extra data context (merged under the template's top-level keys). */
  data?: Record<string, unknown>;
}

export interface CompiledTemplate {
  /** TSC/TSPL2 command string. */
  tsc: string;
  /** ZPL II command string. */
  zpl: string;
  /** SVG preview (via portakal-lite). */
  svg: string;
  /** The resolved dot layout (for debugging / custom use). */
  layout: Layout;
}

/** Build a portakal-lite label builder from a resolved template + layout. */
export function buildLabel(
  resolved: ResolvedTemplate,
  layout: Layout,
  dpi = 203,
  fontBase?: { width: number; height: number },
  font0Mode: "multiplier" | "points" = "multiplier",
  charWidthFactor?: number,
  printParams: Partial<
    Pick<
      PrintSpec,
      | "gap"
      | "margin"
      | "speed"
      | "density"
      | "direction"
      | "copies"
    >
  > = {},
  unit: "mm" | "inch" | "dot" = "mm",
): LabelBuilder {
  // The builder is constructed in dot space; convert any physical (mm/inch)
  // print params so they're not misinterpreted as dots.
  const toDotsIfPhysical = (v: number | undefined): number | undefined =>
    v != null ? (unit === "dot" ? Math.round(v) : Math.round(toDots(v, unit, dpi))) : undefined;

  const rawMarginNum = typeof printParams.margin === "number" ? printParams.margin : undefined;
  const rawMarginObj =
    typeof printParams.margin === "object" && printParams.margin !== null ? printParams.margin : undefined;

  const marginParam =
    rawMarginNum != null
      ? toDotsIfPhysical(rawMarginNum)
      : rawMarginObj != null
        ? {
            top: toDotsIfPhysical(rawMarginObj.top),
            bottom: toDotsIfPhysical(rawMarginObj.bottom),
            left: toDotsIfPhysical(rawMarginObj.left),
            right: toDotsIfPhysical(rawMarginObj.right),
          }
        : undefined;

  const b = label({
    width: layout.widthDots,
    height: layout.heightDots,
    unit: "dot",
    dpi,
    fontBase,
    font0Mode,
    charWidthFactor,
    gap: toDotsIfPhysical(printParams.gap),
    margin: marginParam,
    speed: printParams.speed,
    density: printParams.density,
    direction: printParams.direction,
    copies: printParams.copies,
  });

  let cellIdx = 0;
  for (const row of resolved.rows) {
    for (const cell of row.cells) {
      const bounds = layout.cells[cellIdx]!;
      cellIdx++;
      addElement(b, cell, bounds, dpi, fontBase, font0Mode, charWidthFactor);
    }
  }
  return b;
}

/** Add one cell's element to the portakal-lite builder at its dot bounds. */
function addElement(
  b: LabelBuilder,
  cell: ResolvedCell,
  bounds: Bounds,
  dpi: number,
  fontBase?: { width: number; height: number },
  font0Mode: "multiplier" | "points" = "multiplier",
  charWidthFactor?: number,
): void {
  const el = cell.element;
  const { x, y, width, height } = bounds;

  switch (el.type) {
    case "text": {
      // Manual layout: compute aligned/wrapped positions, emit plain TEXT
      // commands (no BLOCK) so it works on every TSPL printer.
      const elFactor = el.charWidthFactor ?? charWidthFactor;
      const textScale = bounds.textScale ?? 1;
      const laid = layoutText(el.content, { x, y, width, height }, {
        font: el.font ?? "1",
        fontScale: el.fontScale,
        wrap: el.wrap ?? true,
        align: el.align ?? "left",
        verticalCenter: false,
        dpi,
        fontBase,
        font0Mode,
        charWidthFactor: elFactor,
        textScale,
      });
      for (const line of laid.lines) {
        b.text(line.text, {
          x: line.x,
          y: line.y,
          font: laid.font,
          size: laid.size,
          // Widen on the x-axis only: the row height (y-axis) stays fixed by
          // the cell, so the printed glyphs stretch horizontally like BarTender.
          // Fixed fonts 1-8 require integer multipliers (1-10).
          xScale: laid.font !== "0"
            ? Math.max(1, Math.min(10, Math.round(line.xSize * textScale)))
            : Math.round(line.xSize * textScale),
          // Pass alignment through so the preview can anchor text.
          align: el.align,
          reverse: el.reverse,
          charWidthFactor: elFactor,
        } as Parameters<LabelBuilder["text"]>[1]);
      }
      break;
    }

    case "barcode": {
      const scaled = scaleBarcode(el.content, { x, y, width, height }, { symbology: el.symbology });
      const barX = x + Math.max(0, Math.floor((width - scaled.estimatedWidth) / 2));
      b.barcode(el.content, {
        x: barX,
        y,
        symbology: el.symbology ?? "code128",
        height: scaled.height,
        moduleWidth: scaled.moduleWidth,
        ratio: scaled.ratio,
        readable: el.showText ?? true,
      });
      break;
    }

    case "qrcode": {
      const scaled = scaleQr({ x, y, width, height });
      b.qrcode(el.content, {
        x,
        y,
        cellSize: scaled.cellSize,
        ecc: el.ecc ?? "H",
        showText: el.showText,
      });
      break;
    }

    case "line": {
      const thickness = el.thickness ?? 2;
      if (el.orientation === "vertical") {
        b.line({ x1: x, y1: y, x2: x, y2: y + height, thickness });
      } else {
        b.line({ x1: x, y1: y, x2: x + width, y2: y, thickness });
      }
      break;
    }

    case "box": {
      b.box({ x, y, width, height, thickness: el.thickness ?? 2, radius: el.radius });
      if (el.child) {
        if (el.child.type === "text") {
          // Text child: vertically center in the box, align per the element.
          const elFactor = el.child.charWidthFactor ?? charWidthFactor;
          const textScale = bounds.textScale ?? 1;
          const laid = layoutText(el.child.content, { x, y, width, height }, {
            font: el.child.font ?? "1",
            fontScale: el.child.fontScale,
            wrap: el.child.wrap ?? true,
            align: el.child.align ?? "left",
            verticalCenter: true,
            dpi,
            fontBase,
            font0Mode,
            charWidthFactor: elFactor,
            textScale,
          });
          for (const line of laid.lines) {
            b.text(line.text, {
              x: line.x,
              y: line.y,
              font: laid.font,
              size: laid.size,
              xScale: line.xSize * textScale,
              align: el.child.align,
              charWidthFactor: elFactor,
            } as Parameters<LabelBuilder["text"]>[1]);
          }
        } else {
          addElement(b, { widthPercent: 100, element: el.child }, bounds, dpi, fontBase, font0Mode, charWidthFactor);
        }
      }
      break;
    }

    case "image": {
      // v1: accept a pre-made 1-bit bitmap descriptor (data as comma-separated
      // byte string or a Uint8Array) + target size.
      const bitmap = parseBitmap(el.src);
      if (bitmap) {
        b.image(bitmap, { x, y, width, height });
      }
      break;
    }

    case "space":
      break;
  }
}

/**
 * Parse an image source into a MonochromeBitmap. Accepts a compact descriptor:
 * `"width,height,byte,byte,..."` (dots) — a simple way to embed a 1-bit bitmap
 * in a template without a base64 dependency.
 */
function parseBitmap(src: string): Parameters<LabelBuilder["image"]>[0] | null {
  const parts = src.split(",");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  const bytes = parts.slice(2).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TemplateError(`invalid image src (expected "width,height,byte,..."): ${src.slice(0, 40)}`);
  }
  const bytesPerRow = Math.ceil(width / 8);
  if (bytes.length !== bytesPerRow * height) {
    throw new TemplateError(
      `image src byte count ${bytes.length} does not match ${bytesPerRow * height} bytes for ${width}x${height}`,
    );
  }
  const data = Uint8Array.from(bytes);
  return { data, width, height, bytesPerRow };
}

/**
 * Compile a template + data against a print spec into TSC/ZPL strings + SVG.
 */
export function compileTemplate(
  schema: TemplateSchema,
  data: Record<string, unknown>,
  opts: CompileOptions,
): CompiledTemplate {
  const padding = opts.padding ?? schema.padding ?? 2;
  const resolved = resolveTemplate(schema, data);
  const layout = layoutTemplate(resolved, opts.spec, padding);
  const { dpi = 203, fontBase, font0Mode, charWidthFactor, unit = "mm" } = opts.spec;
  const builder = buildLabel(resolved, layout, dpi, fontBase, font0Mode, charWidthFactor, opts.spec, unit);
  const svg = tscLang.preview(builder);

  return {
    tsc: tscLang.compile(builder),
    zpl: zplLang.compile(builder),
    svg,
    layout,
  };
}
