/**
 * Auto-scaling: given a cell's dot-space bounds, compute concrete font sizes /
 * barcode dimensions / QR cell sizes so the element fits cleanly.
 *
 * Text uses scalable font "0" sized in POINTS (TSC TEXT x,y,"0",w_pt,h_pt;
 * ZPL ^A0N,h,w with points converted to dots at the print DPI). Barcodes and
 * QR codes are sized in dots as before.
 */

import type { Bounds } from "./layout.js";
import { TSC_DOT_FONTS, type TSCTextFont } from "portakal-lite";

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** A single laid-out text line with its final dot position. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
  /**
   * Width sizing for this line, in the font's unit:
   *  - font "0": dots per character (point-size derived).
   *  - fonts "1"–"8": X multiplier (1–10) of the base dot width.
   */
  xSize: number;
}

/** Result of manual text layout: font "0" or a fixed-pitch dot font. */
export interface TextLayout {
  /** Font id — "0" (scalable) or "1"–"8" (fixed-pitch). */
  font: TSCTextFont;
  /**
   * Font height size in the printer's unit:
   *  - font "0": point size (or multiplier of fontBase per `font0Mode`).
   *  - fonts "1"–"8": integer multiplier (1–10) of the base dot height.
   */
  size: number;
  /**
   * How `size` and `xSize` are interpreted:
   *  - "points":     font "0" — size/xSize are point sizes.
   *  - "multiplier": fonts "1"–"8" — size/xSize are multipliers of the base.
   */
  fontKind: "points" | "multiplier";
  /** Approximate font height in dots (line spacing). */
  lineHeight: number;
  /** Each line positioned in dots with per-line xSize. */
  lines: TextLine[];
}

/** Default TSPL font "0" base size in dots at a given DPI. */
function defaultFontBase(dpi: number): { width: number; height: number } {
  const scale = dpi >= 300 ? 1.5 : 1;
  return { width: Math.round(12 * scale), height: Math.round(24 * scale) };
}

/** Resolved metrics for a font: its unit and base dot size. */
interface FontMetrics {
  /** "points" — size/xSize are point sizes; "multiplier" — integer × base. */
  kind: "points" | "multiplier";
  baseW: number;
  baseH: number;
}

/**
 * Map a TSC font id to its sizing mode + base dot size.
 * Font "0" is scalable: its unit follows `font0Mode` (multiplier of fontBase
 * or points). Fonts "1"–"8" are fixed-pitch and always use integer multipliers
 * of their base dot size.
 */
function fontMetrics(
  font: TSCTextFont,
  font0Mode: "multiplier" | "points",
  fontBase: { width: number; height: number },
): FontMetrics {
  if (font === "0") {
    return { kind: font0Mode, baseW: fontBase.width, baseH: fontBase.height };
  }
  const base = TSC_DOT_FONTS[font];
  return { kind: "multiplier", baseW: base.w, baseH: base.h };
}

/** Physical line height in dots for one unit of the given font kind. */
function unitHeightDots(metrics: FontMetrics, dpi: number): number {
  return metrics.kind === "points" ? dpi / 72 : metrics.baseH;
}

/** Physical character width in dots for one unit of the given font kind. */
function unitWidthDots(metrics: FontMetrics, dpi: number, charWidthFactor: number): number {
  return metrics.kind === "points" ? (dpi / 72) * charWidthFactor : metrics.baseW;
}

/** Maximum horizontal stretch: xSize cannot exceed MAX_STRETCH × size. */
const MAX_STRETCH = 2;

/**
 * Lay out text into positioned lines using font "0" or a fixed-pitch font.
 *
 * Sizing is independent on each axis:
 *  - **ySize** (`size`): computed from cell height — the tallest font that fits.
 *  - **xSize** (per line): fills the cell width per character, capped at
 *    `MAX_STRETCH × size` so short text doesn't get absurdly stretched.
 *
 * Units follow the font kind:
 *  - font "0" (scalable): size/xSize are in `font0Mode` units (points, or
 *    multiplier of `fontBase`).
 *  - fonts "1"–"8" (multiplier): size/xSize are integer multipliers 1–10 of
 *    the base dot size (fixed pitch — no width fudge factor).
 *
 * Alignment (left/center/right) uses `xSize` as the character width estimate.
 * No BLOCK: we emit plain TEXT commands for every printer.
 */
export function layoutText(
  content: string,
  bounds: Bounds,
  opts: {
    font?: TSCTextFont;
    /** Max multiplier for fixed fonts 1–8 (integer 1–10, default 10). */
    fontScale?: number;
    wrap?: boolean;
    align?: "left" | "center" | "right";
    verticalCenter?: boolean;
    dpi?: number;
    fontBase?: { width: number; height: number };
    font0Mode?: "multiplier" | "points";
    charWidthFactor?: number;
    /** Horizontal stretch multiplier applied on top of xSize (default 1). */
    textScale?: number;
  } = {},
): TextLayout {
  const {
    font = "1",
    wrap = true,
    align = "left",
    verticalCenter = false,
    dpi = 203,
    textScale = 1,
  } = opts;
  const mode = opts.font0Mode ?? "multiplier";
  const metrics = fontMetrics(font, mode, opts.fontBase ?? defaultFontBase(dpi));
  const factor = opts.charWidthFactor ?? 0.5;
  const usableW = Math.max(1, bounds.width);
  const usableH = Math.max(1, bounds.height);

  // Max unit size on the y-axis: tallest single line that fits the cell.
  const unitH = unitHeightDots(metrics, dpi);
  const unitW = unitWidthDots(metrics, dpi, factor);
  const maxUnits = clamp(Math.floor(usableH / unitH) || 1, 1, 100);
  // Fixed fonts are capped at the multiplier limit (1–10) and fontScale.
  const cap = metrics.kind === "multiplier" ? Math.min(10, clamp(opts.fontScale ?? 10, 1, 10)) : 100;
  const maxYSize = Math.min(maxUnits, cap);

  // ── Determine lines and final ySize ──────────────────────────────────
  let rawLines: string[];
  let size: number; // = ySize

  if (!content || content.length === 0) {
    rawLines = [];
    size = maxYSize;
  } else if (!wrap || !content.trim().includes(" ")) {
    // Single word or no-wrap: one line, use full height.
    rawLines = [content];
    size = maxYSize;
  } else {
    // Multi-word with wrap enabled.
    rawLines = [content];
    size = maxYSize;

    // If single-line xSize < ySize, characters are narrower than tall →
    // wrapping to fewer chars per line gives better proportions.
    const singleXRaw = Math.floor(usableW / (content.length * unitW));
    if (singleXRaw < size) {
      for (let n = 2; n <= 10; n++) {
        const nSize = clamp(
          Math.floor(usableH / (n * unitH)) || 1, 1, cap,
        );
        if (nSize < 1) break;
        // Target chars per line so xSize ≈ nSize (balanced proportions).
        const charsPerLine = Math.max(1, Math.floor(usableW / (nSize * unitW)));
        const wrapped = wrapText(content, charsPerLine);
        if (wrapped.length <= n) {
          rawLines = wrapped;
          size = nSize;
          break;
        }
      }
    }
  }

  // ── Per-line xSize + positioning ──────────────────────────────────────
  const lineHeight = Math.max(1, Math.round(size * unitH));

  // Cap lines to the cell height.
  const maxLines = Math.max(1, Math.floor(usableH / lineHeight));
  const lines = rawLines.slice(0, maxLines);

  // Vertical position: top-aligned, or centered when requested (box children).
  const blockH = lines.length * lineHeight;
  const y0 = verticalCenter
    ? bounds.y + Math.max(0, Math.floor((usableH - blockH) / 2))
    : bounds.y;

  const positioned: TextLine[] = lines.map((text, i) => {
    // Per-line xSize: the largest unit that fits the width (points or
    // multiplier of base width), capped at MAX_STRETCH × size.
    const rawX =
      text.length > 0
        ? Math.floor(usableW / (text.length * unitW))
        : size;
    const xSize = text.length > 0 ? clamp(rawX, 1, MAX_STRETCH * size) : size;

    // Text width in dots for alignment — xSize × unitW × textScale.
    const charW = xSize * unitW * textScale;
    const tw = text.length * charW;
    let x = bounds.x;
    if (align === "center") x = bounds.x + Math.max(0, Math.floor((usableW - tw) / 2));
    else if (align === "right") x = bounds.x + Math.max(0, Math.floor(usableW - tw));

    return { text, x: Math.round(x), y: Math.round(y0 + i * lineHeight), xSize };
  });

  return { font, size, fontKind: metrics.kind, lineHeight, lines: positioned };
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
  /** Total estimated width of the barcode symbol in dots. */
  estimatedWidth: number;
}

/**
 * Auto-scale a 1D barcode into a cell: bar height ~75% of cell height,
 * moduleWidth chosen so the symbol's total width fits the cell.
 * Accurately accounts for start/stop patterns, checksums, and quiet zones.
 */
export function scaleBarcode(
  content: string,
  bounds: Bounds,
  opts: { symbology?: string } = {},
): ScaledBarcode {
  const usableW = Math.max(1, bounds.width);
  const usableH = Math.max(1, bounds.height);

  const height = Math.max(10, Math.round(usableH * 0.75));
  const symbology = (opts.symbology ?? "code128").toLowerCase();
  // Total module count estimate including start/stop patterns, checksums, and quiet zones:
  // - Code 128: 11 (start) + 11*len (data) + 11 (checksum) + 13 (stop) + 20 (quiet) = 55 + 11*len
  // - Code 39: 26 (start/stop) + 13*len (data at ratio 2) + 20 (quiet) = 46 + 13*len
  // - EAN-13 / UPC-A: 95 + 18 (quiet) = 113
  let modules = 55 + 11 * Math.max(1, content.length);
  if (symbology === "ean13" || symbology === "upca" || symbology === "ean-13" || symbology === "upc-a") {
    modules = 113;
  } else if (symbology === "code39" || symbology === "code-39") {
    modules = 46 + 13 * Math.max(1, content.length);
  }
  // moduleWidth = floor(W_cell / modules), at least 1, at most 10.
  const moduleWidth = clamp(Math.floor(usableW / Math.max(1, modules)) || 1, 1, 10);
  const estimatedWidth = modules * moduleWidth;
  return { height, moduleWidth, ratio: 2, estimatedWidth };
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
