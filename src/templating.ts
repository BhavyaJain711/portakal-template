/**
 * Templating: {{var.path}} interpolation + repeat-row expansion.
 * Missing keys throw a TemplateError with the offending key, so templates fail
 * loudly instead of printing "{{x}}".
 */

import type {
  ResolvedTemplate,
  TemplateData,
  TemplateElement,
  TemplateRow,
} from "./types.js";

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Resolve a dotted path against a data object. */
export function resolvePath(data: unknown, path: string): unknown {
  const parts = path.split(".");
  let current = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      throw new TemplateError(`cannot resolve path "${path}": "${part}" is not an object`);
    }
    if (typeof part !== "string" || !(part in (current as Record<string, unknown>))) {
      throw new TemplateError(`missing template key "${path}"`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * The special placeholder for "the current item" inside a repeat row.
 * Repeating over an array of strings binds each string here.
 */
export const ITEM_THIS = "this";

/** Data context a repeat row's cells resolve against. */
export type ItemContext = Record<string, unknown> & { [ITEM_THIS]: unknown };

/** Wrap a repeat item (object, string, number) into a placeholder context. */
export function itemContext(item: unknown): ItemContext {
  if (item !== null && typeof item === "object" && !Array.isArray(item)) {
    return { [ITEM_THIS]: item, ...(item as Record<string, unknown>) };
  }
  // Primitive item (e.g. an array of strings): only {{this}} is available.
  return { [ITEM_THIS]: item };
}

/** Interpolate all {{var.path}} placeholders in a string against data. */
export function interpolate(template: string, data: unknown): string {
  return template.replace(PLACEHOLDER_RE, (raw, path: string) => {
    const pathTrimmed = path.trim();
    if (!pathTrimmed) {
      throw new TemplateError(`empty template placeholder "${raw}"`);
    }
    const value = resolvePath(data, pathTrimmed);
    if (value === null || value === undefined) {
      throw new TemplateError(`missing template key "${pathTrimmed}"`);
    }
    return String(value);
  });
}

/** Recursively interpolate an element's content fields. */
export function interpolateElement(element: TemplateElement, data: unknown): TemplateElement {
  switch (element.type) {
    case "text":
      return { ...element, content: interpolate(element.content, data) };
    case "barcode":
      return { ...element, content: interpolate(element.content, data) };
    case "qrcode":
      return { ...element, content: interpolate(element.content, data) };
    case "box":
      return element.child
        ? { ...element, child: interpolateElement(element.child, data) }
        : element;
    default:
      return element;
  }
}

/**
 * Expand a template against data: resolve placeholders and expand repeat rows.
 * A `repeat` row's `heightPercent` is the PER-ITEM budget: every array element
 * gets that full share (e.g. 30% with 3 items → 30% each). The expanded total
 * can exceed 100%, so all rows are scaled down proportionally to sum to 100 —
 * fixed rows keep their relative weight, so a 40% design row stays dominant
 * whether there are 1 or 6 part rows. Empty arrays expand to nothing. Nested
 * repeats throw.
 */
export function resolveTemplate(
  schema: { rows: TemplateRow[] },
  data: TemplateData,
): ResolvedTemplate {
  const rows: ResolvedTemplate["rows"] = [];

  for (const row of schema.rows) {
    if (row.repeat) {
      const arr = resolvePath(data, row.repeat);
      if (!Array.isArray(arr)) {
        throw new TemplateError(`repeat key "${row.repeat}" must reference an array`);
      }
      for (const item of arr) {
        if (item === null || item === undefined) {
          throw new TemplateError(
            `repeat key "${row.repeat}" contains a null/undefined element`,
          );
        }
        // Object items expose their fields; primitive items (arrays of
        // strings/numbers) are available via {{this}}.
        const itemData = itemContext(item);
        // Detect nested repeats (not supported in v1).
        for (const cell of row.cells) {
          assertNoRepeat(cell.element);
        }
        rows.push({
          // Per-item budget: each expanded row gets the row's full share.
          heightPercent: row.heightPercent,
          cells: row.cells.map((c) => ({
            widthPercent: c.widthPercent,
            element: interpolateElement(c.element, itemData),
          })),
        });
      }
    } else {
      rows.push({
        heightPercent: row.heightPercent,
        cells: row.cells.map((c) => ({
          widthPercent: c.widthPercent,
          element: interpolateElement(c.element, data),
        })),
      });
    }
  }

  // Normalize: scale every row so the heights sum to 100%. With repeat rows
  // the raw total exceeds 100 (each item took the full budget); scaling down
  // keeps each row's relative weight — the design row stays biggest.
  const total = rows.reduce((acc, r) => acc + r.heightPercent, 0);
  if (rows.length > 0 && Math.abs(total - 100) > 0.001) {
    const scale = 100 / total;
    for (const r of rows) {
      r.heightPercent = r.heightPercent * scale;
    }
  }

  return { data, rows };
}

function assertNoRepeat(element: TemplateElement): void {
  if (element.type === "box" && element.child) {
    assertNoRepeat(element.child);
  }
  // Element types carry no `repeat` — nested repeats would be on nested rows,
  // which the schema doesn't allow. This is a guard for future expansion.
}
