/**
 * Template schema types for portakal-template.
 *
 * A template describes a label *proportionally* — percentage rows and
 * percentage cells — and is deliberately device-agnostic: it stores NO
 * physical width/height/DPI. Those are supplied at print time via `PrintSpec`,
 * so one template adapts to any label size or printer.
 */

/** Physical print parameters, supplied at compile time (not stored in the template). */
export interface PrintSpec {
  /** Label width */
  width: number;
  /** Label height */
  height: number;
  /** Unit of measurement (default "mm") */
  unit?: "mm" | "inch" | "dot";
  /** Printer DPI (default 203) */
  dpi?: number;
  /** Gap between labels in mm (default 3) */
  gap?: number;
  /**
   * Margin around the whole content area, in `unit` (default 0). Insets the
   * layout so nothing prints into the unreliable edge of the sticker.
   * Can be a single number (applied to all sides) or an object `{ top?, bottom?, left?, right? }`.
   */
  margin?: number | {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  /** Print speed (default 4) */
  speed?: number;
  /** Print darkness 0-15 (default 8) */
  density?: number;
  /** Print direction (default 0) */
  direction?: 0 | 1;
  /** Number of copies (default 1) */
  copies?: number;
  /** Optional printer profile id to inherit defaults from (e.g. "zebra-zd420") */
  printer?: string;
  /**
   * TSPL font "0" base size in dots (12×24 @ 203, 18×36 @ 300). Inherited from
   * the printer profile when `printer` is set; overridable here.
   */
  fontBase?: { width: number; height: number };
  /**
   * TSPL font "0" size mode: "multiplier" (of fontBase) or "points".
   * Inherited from the printer profile when `printer` is set; default
   * "multiplier". Firmware varies — set "points" if your printer treats
   * font "0" sizes as point sizes.
   */
  font0Mode?: "multiplier" | "points";
  /**
   * Default average glyph width relative to the font height for text width
   * estimates (default 0.5). Font "0" (CG Triumvirate Bold Condensed) runs
   * ~0.5× the point height; tune per printer/font if centered text drifts.
   * Per-element override via the text element's `charWidthFactor`.
   */
  charWidthFactor?: number;
}

/** A declarative, device-agnostic label template. */
export interface TemplateSchema {
  /** Template id (optional metadata) */
  id?: string;
  /** Template name (optional metadata) */
  name?: string;
  /** Padding inside each cell, in dots (default 2) */
  padding?: number;
  /** Rows stacked top→down; heights are percentages of the label height. */
  rows: TemplateRow[];
}

/** One row of the template. */
export interface TemplateRow {
  /** Row height as a percentage of the label height (e.g. 20 = 20%). */
  heightPercent: number;
  /**
   * Data key for a dynamic/repeated row. When set, the row expands once per
   * element of the array at `data[repeat]`, and `{{...}}` inside resolves
   * against each element. Nested repeats are not supported.
   */
  repeat?: string;
  /**
   * Horizontal text stretch multiplier for all text in this row (default 1).
   * 0.5–3.0; widens glyphs on the x-axis only — the row height (y-axis) and
   * the auto-computed font size stay fixed, like BarTender's width scaling.
   */
  textScale?: number;
  /** Cells laid left→right; widths are percentages of the label width. */
  cells: TemplateCell[];
}

/** One cell of a row. */
export interface TemplateCell {
  /** Cell width as a percentage of the label width (e.g. 30 = 30%). */
  widthPercent: number;
  /** The element rendered in this cell. */
  element: TemplateElement;
}

/** Supported template element types. */
export type TemplateElement =
  | {
      type: "text";
      /** Text content; may contain {{var}} placeholders. */
      content: string;
      /**
       * TSC font: "0" (scalable TrueType, sized in points) or "1"–"8"
       * (fixed-pitch dot fonts, sized as an integer multiplier 1–10 of their
       * base size — see TSC_DOT_FONTS). Default "1".
       */
      font?: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
      /**
       * Max font size multiplier for fixed fonts 1–8 (integer 1–10, default 10).
       * The engine auto-picks the largest multiplier that fits the cell,
       * capped at this value. Ignored for font "0" (points-based).
       */
      fontScale?: number;
      align?: "left" | "center" | "right";
      bold?: boolean;
      reverse?: boolean;
      /** Wrap long text to multiple lines within the cell (default true). */
      wrap?: boolean;
      /**
       * Average glyph width relative to the font height, used to estimate the
       * line width for size/positioning (default 0.5). TrueType font "0" (CG
       * Triumvirate Bold Condensed) runs ~0.5× the point height; tune per
       * printer/font if text overflows or underfills. Not needed when the
       * printer centers via BLOCK/^FB — that
       * uses the real glyph widths on the device.
       */
      charWidthFactor?: number;
    }
  | {
      type: "barcode";
      /** Content to encode; may contain {{var}} placeholders. */
      content: string;
      /** Symbology: "code128" (default), "code39", "ean13", "upca", ... (etiket). */
      symbology?: string;
      /** Show human-readable text below the bars (default true). */
      showText?: boolean;
    }
  | {
      type: "qrcode";
      /** Content to encode; may contain {{var}} placeholders. */
      content: string;
      /** Error correction level (default "H"). */
      ecc?: "L" | "M" | "Q" | "H";
      /** Show human-readable text below the QR code (default false). */
      showText?: boolean;
    }
  | {
      type: "line";
      /** Line thickness in dots (default 2). */
      thickness?: number;
      /** Orientation (default "horizontal"). */
      orientation?: "horizontal" | "vertical";
    }
  | {
      type: "box";
      /** Frame thickness in dots (default 2). */
      thickness?: number;
      /** Corner radius in dots (default 0). */
      radius?: number;
      /** Optional inner element drawn inside the box. */
      child?: TemplateElement;
    }
  | {
      type: "image";
      /** Monochrome bitmap source. */
      src: string;
      /** Whether to dither (reserved; v1 accepts pre-made 1-bit bitmaps only). */
      dither?: boolean;
    }
  | { type: "space" };

/** The data object used to interpolate {{var}} placeholders and repeat rows. */
export type TemplateData = Record<string, unknown>;

/** A repeat-row instance: one expanded row + the data slice it renders against. */
export interface RepeatInstance {
  /** Row definition (with `repeat` set). */
  row: TemplateRow;
  /** Data for this instance (the array element). */
  data: Record<string, unknown>;
}

/** Fully interpolated template: no placeholders, repeat rows expanded. */
export interface ResolvedTemplate {
  /** Root data (repeat instances reference their own element). */
  data: TemplateData;
  /** Expanded rows in order: static rows + one entry per repeat instance. */
  rows: ResolvedRow[];
}

export interface ResolvedRow {
  /** Percentage of label height. */
  heightPercent: number;
  /** Horizontal text stretch multiplier for all text in this row (default 1). */
  textScale?: number;
  /** Interpolated cells. */
  cells: ResolvedCell[];
}

export interface ResolvedCell {
  /** Percentage of label width. */
  widthPercent: number;
  /** Interpolated element (content placeholders filled). */
  element: ResolvedTemplateElement;
}

export type ResolvedTemplateElement = TemplateElement;
