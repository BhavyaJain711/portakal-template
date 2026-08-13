/**
 * Template validation — framework-agnostic checks for TemplateSchema.
 * Returns a structured result (errors/warnings with paths) instead of
 * throwing, so UI builders can surface issues inline and servers can reuse
 * the same rules. Compile-time checks (layout, interpolation) are NOT run
 * here — this validates the schema shape, allowed variables, and element
 * configuration before anything is sent to a printer.
 */

import type { TemplateElement, TemplateRow, TemplateSchema } from "./types.js";

/** One validation issue with a dot path into the template. */
export interface ValidationIssue {
  /** Dot path into the template, e.g. `rows[0].cells[0].element.content`. */
  path: string;
  message: string;
  level: "error" | "warning";
}

/** Result of validateTemplate — never throws for template problems. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** A variable definition, or a bare key string. */
export type AllowedVariable = { key: string; label?: string } | string;

function keyOf(v: AllowedVariable): string {
  return typeof v === "string" ? v : v.key;
}

const ALIGNS = new Set(["left", "center", "right"]);
const ECCS = new Set(["L", "M", "Q", "H"]);
const ORIENTATIONS = new Set(["horizontal", "vertical"]);
const ELEMENT_TYPES = new Set(["text", "barcode", "qrcode", "line", "box", "image", "space"]);
/** Common etiket symbologies accepted by the template layer. */
const SYMBOLOGIES = new Set([
  "code128", "code39", "code39ext", "code93", "ean13", "ean8", "upca", "upce",
  "itf", "itf14", "codabar", "msi", "gs1-128",
]);

const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** All {{placeholders}} in a string (deduplicated). */
export function extractPlaceholders(content: string): string[] {
  const found: string[] = [];
  for (const m of content.matchAll(PLACEHOLDER_RE)) {
    const key = m[1]!.trim();
    if (key && !found.includes(key)) found.push(key);
  }
  return found;
}

interface Ctx {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  allowed?: Set<string>;
  /** When set, placeholders inside this repeat row resolve relative to the
   *  item, so "{{name}}" is valid when `repeat + ".name"` is allowed. */
  repeatPrefix?: string;
  path: string; // current element path, e.g. rows[0].cells[0].element
}

function addError(ctx: Ctx, message: string): void {
  ctx.errors.push({ path: ctx.path, message, level: "error" });
}
function addWarning(ctx: Ctx, message: string): void {
  ctx.warnings.push({ path: ctx.path, message, level: "warning" });
}

/** Validate variable placeholders in a content string against allowed keys. */
function validatePlaceholders(ctx: Ctx, content: string, field: string): void {
  const value = content ?? "";
  const keys = extractPlaceholders(value);
  for (const key of keys) {
    if (ctx.allowed) {
      // In a repeat row, the placeholder may be a field of the item, an
      // absolute allowed key, or the special "{{this}}" (current item).
      const relative = ctx.repeatPrefix ? `${ctx.repeatPrefix}.${key}` : null;
      const ok =
        key === "this" ||
        ctx.allowed.has(key) ||
        (relative != null && ctx.allowed.has(relative));
      if (!ok) {
        addError(ctx, `"{{${key}}}" is not an allowed variable`);
      }
    }
  }
  // Stray opening braces (no closing) that aren't a valid placeholder.
  if (/\{\{\s*[^{}]*$/.test(value) && !keys.length) {
    addWarning(ctx, `stray "{{" without a closing "}}" in ${field}`);
  }
}

/** Validate one element (recursing into box children). */
function validateElement(ctx: Ctx, el: TemplateElement | undefined, field: string): void {
  if (!el || typeof el !== "object") {
    addError(ctx, `${field} is missing`);
    return;
  }
  const elPath = `${ctx.path}.${field}`;
  if (!el.type || typeof el.type !== "string") {
    addError(ctx, `${field} is missing a "type"`);
    return;
  }
  if (!ELEMENT_TYPES.has(el.type)) {
    addError(ctx, `unknown element type "${el.type}" (expected one of ${[...ELEMENT_TYPES].join(", ")})`);
    return;
  }

  const sub: Ctx = { ...ctx, path: elPath };

  switch (el.type) {
    case "text": {
      if (typeof el.content !== "string") addError(sub, "text content must be a string");
      else if (el.content.trim() === "") addWarning(sub, "text content is empty");
      else validatePlaceholders(sub, el.content, "content");
      if (el.align !== undefined && !ALIGNS.has(el.align)) addError(sub, `invalid align "${el.align}" (expected left|center|right)`);
      break;
    }
    case "barcode": {
      if (typeof el.content !== "string") addError(sub, "barcode content must be a string");
      else if (el.content.trim() === "") addWarning(sub, "barcode content is empty");
      else validatePlaceholders(sub, el.content, "content");
      if (el.symbology !== undefined && !SYMBOLOGIES.has(el.symbology)) {
        addError(sub, `unknown symbology "${el.symbology}"`);
      }
      break;
    }
    case "qrcode": {
      if (typeof el.content !== "string") addError(sub, "qrcode content must be a string");
      else if (el.content.trim() === "") addWarning(sub, "qrcode content is empty");
      else validatePlaceholders(sub, el.content, "content");
      if (el.ecc !== undefined && !ECCS.has(el.ecc)) {
        addError(sub, `invalid ecc "${el.ecc}" (expected L|M|Q|H)`);
      }
      break;
    }
    case "line": {
      if (el.orientation !== undefined && !ORIENTATIONS.has(el.orientation)) {
        addError(sub, `invalid orientation "${el.orientation}" (expected horizontal|vertical)`);
      }
      break;
    }
    case "box": {
      if (el.child !== undefined) validateElement(sub, el.child, "child");
      break;
    }
    case "image": {
      if (typeof el.src !== "string" || el.src.trim() === "") {
        addError(sub, 'image src must be a string like "width,height,byte,..."');
      }
      break;
    }
    case "space":
      break;
  }
}

/**
 * Validate a template schema. With `allowedVariables`, every {{placeholder}}
 * must match one of the allowed keys (repeat keys included). Returns issues,
 * never throws. Structural checks:
 *  - rows non-empty, heights positive
 *  - each row ≥1 cell, widths positive and summing to ~100
 *  - static row heights sum to ~100 (skipped when a repeat row exists —
 *    resolveTemplate rescales the expanded total)
 */
export function validateTemplate(
  schema: TemplateSchema,
  options: { allowedVariables?: AllowedVariable[] } = {},
): ValidationResult {
  const ctx: Ctx = {
    errors: [],
    warnings: [],
    path: "rows",
    allowed: options.allowedVariables
      ? new Set(options.allowedVariables.map(keyOf).filter(Boolean))
      : undefined,
  };

  const rows: TemplateRow[] = Array.isArray(schema?.rows) ? schema.rows : [];
  if (rows.length === 0) {
    ctx.errors.push({ path: "rows", message: "template must have at least one row", level: "error" });
    return { valid: false, errors: ctx.errors, warnings: ctx.warnings };
  }

  let heightSum = 0;
  let hasRepeat = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowPath = `rows[${i}]`;

    if (!Number.isFinite(row.heightPercent) || row.heightPercent <= 0) {
      ctx.errors.push({ path: `${rowPath}.heightPercent`, message: "row heightPercent must be a positive number", level: "error" });
    } else {
      heightSum += row.heightPercent;
    }

    if (row.repeat !== undefined) {
      hasRepeat = true;
      if (ctx.allowed && !ctx.allowed.has(row.repeat)) {
        ctx.errors.push({ path: `${rowPath}.repeat`, message: `"${row.repeat}" is not an allowed variable`, level: "error" });
      }
    }

    const cells = Array.isArray(row.cells) ? row.cells : [];
    if (cells.length === 0) {
      ctx.errors.push({ path: `${rowPath}.cells`, message: "row must have at least one cell", level: "error" });
      continue;
    }

    let widthSum = 0;
    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j]!;
      const cellPath = `${rowPath}.cells[${j}]`;
      if (!Number.isFinite(cell.widthPercent) || cell.widthPercent <= 0) {
        ctx.errors.push({ path: `${cellPath}.widthPercent`, message: "cell widthPercent must be a positive number", level: "error" });
      } else {
        widthSum += cell.widthPercent;
      }
      const sub: Ctx = {
        ...ctx,
        path: cellPath,
        // Inside a repeat row, {{field}} resolves against each item.
        repeatPrefix: row.repeat,
      };
      validateElement(sub, cell.element, "element");
    }
    if (Math.abs(widthSum - 100) > 0.001) {
      ctx.errors.push({ path: `${rowPath}.cells`, message: `row widths sum to ${widthSum}, expected ~100`, level: "error" });
    }
  }

  if (!hasRepeat && Math.abs(heightSum - 100) > 0.001) {
    ctx.errors.push({ path: "rows", message: `row heights sum to ${heightSum}, expected ~100`, level: "error" });
  }

  return { valid: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings };
}
