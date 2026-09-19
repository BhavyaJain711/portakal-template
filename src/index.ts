/**
 * portakal-template — percentage-layout label templates on top of portakal-lite.
 * Declarative JSON template + data → a printer-ready result, with auto-scaling
 * layout. Device-agnostic: label size/DPI are supplied at compile time via
 * PrintSpec, so one template adapts to any printer.
 *
 * `compileTemplate` returns both forms of the TSC output: `tsc` is the binary
 * wire stream to send, and `tscText` is a display rendering of it (a BITMAP
 * payload is raw pixels and cannot be shown or sent as text). ZPL is a string.
 */

export { TemplateError, interpolate, resolvePath, resolveTemplate, itemContext, ITEM_THIS } from "./templating.js";
export type { ItemContext } from "./templating.js";
export { layoutTemplate, toDots, validatePercentages } from "./layout.js";
export type { Bounds, Layout } from "./layout.js";
export { compileTemplate, buildLabel } from "./compile.js";
export type { CompiledTemplate, CompileOptions } from "./compile.js";
export { parseBitmap, bitmapToDescriptor } from "./image.js";
export { scaleBarcode, scaleQr, layoutText } from "./autoscale.js";
export type { ScaledBarcode, ScaledQr, TextLine, TextLayout } from "./autoscale.js";
export { TSC_DOT_FONTS, type TSCTextFont } from "portakal-lite";
export { formatTSCBytes, bytesToBase64, base64ToBytes, chunkBytes } from "portakal-lite";
export { validateTemplate, extractPlaceholders } from "./validate.js";
export type { ValidationIssue, ValidationResult, AllowedVariable } from "./validate.js";
export type {
  PrintSpec,
  TemplateSchema,
  TemplateRow,
  TemplateCell,
  ColumnItem,
  TemplateElement,
  TemplateData,
  ResolvedTemplate,
  ResolvedRow,
  ResolvedCell,
  ResolvedTemplateElement,
} from "./types.js";
