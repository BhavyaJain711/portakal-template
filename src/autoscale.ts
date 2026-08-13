/**
 * Auto-scaling: given a cell's dot-space bounds, compute concrete font sizes /
 * barcode dimensions / QR cell sizes so the element fits cleanly.
 *
 * Text uses scalable font "0" sized in POINTS (TSC TEXT x,y,"0",w_pt,h_pt;
 * ZPL ^A0N,h,w with points converted to dots at the print DPI). Barcodes and
 * QR codes are sized in dots as before.
 */

import type { Bounds } from "./layout.js";

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** A single laid-out text line with its final dot position. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
}

/** Result of manual text layout: font "0" + positioned lines. */
export interface TextLayout {
  /** Font id — always "0" (scalable TrueType) for broad printer support. */
  font: string;
  /**
   * Font size in the printer's `font0Mode` unit:
   *  - "multiplier": a multiplier of fontBase (12×24 @ 203 DPI).
   *  - "points":     a point size (1pt = 1/72in).
   */
  size: number;
  /** Approximate font height in dots (line spacing). */
  lineHeight: number;
  /** Each line positioned in dots (aligned/wrapped/centered). */
  lines: TextLine[];
}

/** Default TSPL font "0" base size in dots at a given DPI. */
function defaultFontBase(dpi: number): { width: number; height: number } {
  const scale = dpi >= 300 ? 1.5 : 1;
  return { width: Math.round(12 * scale), height: Math.round(24 * scale) };
}

/**
 * Physical char width in dots for a size value in the given mode.
 * `charWidthFactor` (default 0.6) is the average glyph width relative to the
 * font height. 0.5 was too optimistic — the portakal-lite preview renders font
 * "0" as monospace with `width = 0.6 × size`, and printer TrueType fonts run
 * wide on uppercase-heavy content, so fitting with 0.6 avoids overflow on both.
 */
function charWidthDots(
  size: number,
  mode: "multiplier" | "points",
  fontBase: { width: number; height: number },
  dpi: number,
  charWidthFactor = 0.6,
): number {
  if (mode === "points") {
    return size * (dpi / 72) * charWidthFactor;
  }
  // Fixed-pitch scalable: char = base width × multiplier.
  return fontBase.width * size * charWidthFactor;
}

/** Physical line height in dots for a size value in the given mode. */
function lineHeightDots(
  size: number,
  mode: "multiplier" | "points",
  fontBase: { width: number; height: number },
  dpi: number,
): number {
  if (mode === "points") return size * (dpi / 72);
  return fontBase.height * size;
}

/**
 * Lay out text into positioned lines using scalable font "0". The `size` unit
 * follows the printer's `font0Mode` (multiplier of the DPI base, or points).
 * No BLOCK: we compute each line's x (left/center/right) and y (stacking /
 * vertical centering) ourselves, then emit plain TEXT commands — works on
 * every TSPL printer.
 */
export function layoutText(
  content: string,
  bounds: Bounds,
  opts: {
    wrap?: boolean;
    align?: "left" | "center" | "right";
    verticalCenter?: boolean;
    dpi?: number;
    fontBase?: { width: number; height: number };
    font0Mode?: "multiplier" | "points";
    charWidthFactor?: number;
  } = {},
): TextLayout {
  const { wrap = true, align = "left", verticalCenter = false, dpi = 203, charWidthFactor = 0.6 } = opts;
  const mode = opts.font0Mode ?? "multiplier";
  const base = opts.fontBase ?? defaultFontBase(dpi);
  const usableW = Math.max(1, bounds.width);
  const usableH = Math.max(1, bounds.height);

  const charW = (s: number) => charWidthDots(s, mode, base, dpi, charWidthFactor);
  const lineH = (s: number) => lineHeightDots(s, mode, base, dpi);

  // Height-based size: target ~80% of cell height. Divide by the real line
  // height at size 1 so the font size accounts for the font's own height
  // (a point size is a glyph-height unit, not a dot-pitch multiplier).
  const heightSize = clamp(Math.floor((usableH * 0.8) / lineH(1)) || 1, 1, 100);

  // Width-based size for a single line (per-char glyph width, not dots).
  const widthSize =
    content.length > 0
      ? clamp(Math.floor(usableW / Math.max(1, content.length) / charW(1)) || 1, 1, 100)
      : heightSize;

  let size: number;
  let rawLines: string[];

  if (wrap && !content.trim().includes(" ")) {
    // Single word: can't wrap; use the smaller of height/width size.
    size = Math.min(heightSize, widthSize);
    rawLines = content ? [content] : [];
  } else if (wrap) {
    // Multi-word: try to fit on one line first (smaller of height/width).
    let s = Math.max(1, Math.min(heightSize, widthSize));
    let maxChars = Math.max(1, Math.floor(usableW / charW(s)));
    rawLines = wrapText(content, maxChars);
    if (rawLines.length === 1) {
      size = s;
    } else {
      // Wrapped: ensure N lines × lineHeight ≤ cell height.
      for (;;) {
        const need = Math.max(1, rawLines.length);
        if (need * lineH(s) <= usableH || s <= 1) break;
        s -= 1;
        maxChars = Math.max(1, Math.floor(usableW / charW(s)));
        rawLines = wrapText(content, maxChars);
      }
      size = s;
    }
  } else {
    // No wrap: use height size, but shrink if the single line overflows width.
    size = heightSize;
    rawLines = content.length > 0 ? [content] : [];
    const tw = content.length * charW(size);
    if (tw > usableW) {
      size = clamp(Math.floor(usableW / Math.max(1, content.length) / charW(1)) || 1, 1, size);
    }
  }

  const lineHeight = Math.max(1, Math.round(lineH(size)));

  // Cap lines to the cell height.
  const maxLines = Math.max(1, Math.floor(usableH / lineHeight));
  const lines = rawLines.slice(0, maxLines);

  // Vertical position: top-aligned, or centered when requested (box children).
  const blockH = lines.length * lineHeight;
  const y0 = verticalCenter
    ? bounds.y + Math.max(0, Math.floor((usableH - blockH) / 2))
    : bounds.y;

  const positioned: TextLine[] = lines.map((text, i) => {
    const tw = text.length * charW(size);
    let x = bounds.x;
    if (align === "center") x = bounds.x + Math.max(0, Math.floor((usableW - tw) / 2));
    else if (align === "right") x = bounds.x + Math.max(0, usableW - tw);
    return { text, x: Math.round(x), y: Math.round(y0 + i * lineHeight) };
  });

  return { font: "0", size, lineHeight, lines: positioned };
}

/** Wrap text into lines of at most `maxChars` characters (word boundaries). */
function wrapText(content: string, maxChars: number): string[] {
  if (maxChars <= 0) return content ? [content] : [];
  const words = content.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length <= maxChars || !cur) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface ScaledBarcode {
  /** Bar height in dots. */
  height: number;
  /** Narrow element width in dots. */
  moduleWidth: number;
  /** Wide:narrow ratio. */
  ratio: number;
}

/**
 * Auto-scale a 1D barcode into a cell: bar height ~75% of cell height,
 * moduleWidth chosen so the symbol's total width fits the cell.
 * Uses a heuristic estimate of module count for the symbology.
 */
export function scaleBarcode(
  content: string,
  bounds: Bounds,
  opts: { symbology?: string } = {},
): ScaledBarcode {
  const usableW = Math.max(1, bounds.width);
  const usableH = Math.max(1, bounds.height);

  const height = Math.round(usableH * 0.75);
  // Heuristic modules per char; code128 ~11, code39 ~16 incl. spacing, ean13 ~95 total.
  const symbology = opts.symbology ?? "code128";
  const modules = symbology === "ean13" ? 95 : symbology === "code39" ? 16 * content.length : 11 * content.length;
  // moduleWidth = floor(W_cell / modules), at least 1, at most 10.
  const moduleWidth = clamp(Math.floor(usableW / Math.max(1, modules)) || 1, 1, 10);
  return { height, moduleWidth, ratio: 2 };
}

export interface ScaledQr {
  /** Module (cell) width in dots. */
  cellSize: number;
}

/**
 * Auto-scale a QR code into a cell: estimate the module size so a QR matrix
 * (heuristically ~25 modules, QR v2-ish) fits min(W,H). The rasterized QR is
 * real regardless — this just sizes it nicely.
 */
export function scaleQr(bounds: Bounds): ScaledQr {
  const side = Math.min(bounds.width, bounds.height);
  // ~25 modules + quiet zone; floor to a clean integer.
  const cellSize = clamp(Math.floor(side / 29) || 1, 1, 32);
  return { cellSize };
}
