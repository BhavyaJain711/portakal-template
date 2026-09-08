/**
 * Smart bounding-box layout: convert percentage rows/cells into exact dot
 * coordinates for a given label size (the PrintSpec), handling repeat-row
 * expansion and cell padding.
 */

import type { PrintSpec, ResolvedTemplate } from "./types.js";
import { TemplateError } from "./templating.js";

/** Convert a physical dimension to dots at the given DPI. */
export function toDots(value: number, unit: "mm" | "inch" | "dot", dpi: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TemplateError(`label dimension must be a positive finite number, got ${String(value)}`);
  }
  if (unit === "dot") return Math.round(value);
  if (unit === "inch") return Math.round(value * dpi);
  return Math.round((value / 25.4) * dpi); // mm
}

/** A concrete dot-space rectangle. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Horizontal text stretch multiplier for this cell (from its row, default 1). */
  textScale?: number;
}

/** Layout result: label-level dot dimensions + one rectangle per cell. */
export interface Layout {
  widthDots: number;
  heightDots: number;
  /** Flat list of cell bounds in render order (rows top→down, cells left→right). */
  cells: Bounds[];
}

/** Validate that percentages are positive and (for rows/cells) sum to ~100. */
export function validatePercentages(rows: ResolvedTemplate["rows"]): void {
  for (const row of rows) {
    if (!Number.isFinite(row.heightPercent) || row.heightPercent <= 0) {
      throw new TemplateError(`row heightPercent must be a positive number, got ${String(row.heightPercent)}`);
    }
    let widthSum = 0;
    for (const cell of row.cells) {
      if (!Number.isFinite(cell.widthPercent) || cell.widthPercent <= 0) {
        throw new TemplateError(
          `cell widthPercent must be a positive number, got ${String(cell.widthPercent)}`,
        );
      }
      widthSum += cell.widthPercent;
    }
    if (Math.abs(widthSum - 100) > 0.001) {
      throw new TemplateError(
        `row widths sum to ${widthSum}, expected ~100`,
      );
    }
  }
  const heightSum = rows.reduce((acc, r) => acc + r.heightPercent, 0);
  if (Math.abs(heightSum - 100) > 0.001) {
    throw new TemplateError(`row heights sum to ${heightSum}, expected ~100`);
  }
}

/**
 * Compute the dot-space layout for a resolved template.
 * Rows stack top→down by heightPercent; each row's cells fill left→right by
 * widthPercent. `margin` (from the spec, dots) insets the whole content area
 * on all sides — for when the sticker/media isn't aligned perfectly with the
 * printer origin. `padding` (dots) is applied inside every cell.
 */
export function layoutTemplate(
  resolved: ResolvedTemplate,
  spec: PrintSpec,
  padding: number,
): Layout {
  validatePercentages(resolved.rows);

  const unit = spec.unit ?? "mm";
  const dpi = spec.dpi ?? 203;
  const widthDots = toDots(spec.width, unit, dpi);
  const heightDots = toDots(spec.height, unit, dpi);

  // Global margins: inset the printable area so content never prints into the
  // unreliable edge of the sticker. Support single margin or 4-directional margins.
  let rawMl = 0;
  let rawMr = 0;
  let rawMt = 0;
  let rawMb = 0;

  if (typeof spec.margin === "number" && spec.margin > 0) {
    rawMl = rawMr = rawMt = rawMb = spec.margin;
  } else if (spec.margin && typeof spec.margin === "object") {
    if (spec.margin.top != null && spec.margin.top > 0) rawMt = spec.margin.top;
    if (spec.margin.bottom != null && spec.margin.bottom > 0) rawMb = spec.margin.bottom;
    if (spec.margin.left != null && spec.margin.left > 0) rawMl = spec.margin.left;
    if (spec.margin.right != null && spec.margin.right > 0) rawMr = spec.margin.right;
  }

  const marginLeft = rawMl > 0 ? Math.round(toDots(rawMl, unit, dpi)) : 0;
  const marginRight = rawMr > 0 ? Math.round(toDots(rawMr, unit, dpi)) : 0;
  const marginTop = rawMt > 0 ? Math.round(toDots(rawMt, unit, dpi)) : 0;
  const marginBottom = rawMb > 0 ? Math.round(toDots(rawMb, unit, dpi)) : 0;

  const usableW = Math.max(1, widthDots - marginLeft - marginRight);
  const usableH = Math.max(1, heightDots - marginTop - marginBottom);

  const cells: Bounds[] = [];
  let y = marginTop;
  for (const row of resolved.rows) {
    const rowH = Math.round((usableH * row.heightPercent) / 100);
    let x = marginLeft;
    for (const cell of row.cells) {
      const cellW = Math.round((usableW * cell.widthPercent) / 100);
      const px = Math.min(padding, Math.floor(cellW / 2));
      const py = Math.min(padding, Math.floor(rowH / 2));
      cells.push({
        x: x + px,
        y: y + py,
        width: Math.max(1, cellW - px * 2),
        height: Math.max(1, rowH - py * 2),
        textScale: row.textScale,
      });
      x += cellW;
    }
    y += rowH;
  }

  return { widthDots, heightDots, cells };
}
