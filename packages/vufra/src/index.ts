/**
 * Vufra v0.1 — experimental native Rust PDF SDK for Node.js.
 *
 * The caller provides the font as bytes; there is no OS font lookup inside Vufra.
 * Returned bytes are a standard PDF. Text shaping is currently limited to
 * Latin-script test cases with no advanced bidi/fallback guarantee.
 */
export interface PdfDocument {
  /** Shown in the running header. Required, nonempty. */
  title: string;
  /** Paragraphs in the desired order before table rows. */
  paragraphs?: string[];
  /** A table-like list of rows; repeated headers and pagination are automatic. */
  rows?: string[];
}

interface NativeBinding {
  renderPdfNative(title: string, paragraphs: string[], rows: string[], font: Uint8Array): Uint8Array;
}
declare const require: (path: string) => NativeBinding;

// Built locally from bindings/vufra-node; published platform binaries are a future task.
const native: NativeBinding = require('../native/vufra.node');

export function renderPdf(document: PdfDocument, font: Uint8Array): Uint8Array {
  if (!document || typeof document.title !== 'string' || !document.title.trim()) {
    throw new TypeError('Vufra requires a nonempty document.title');
  }
  if (!(font instanceof Uint8Array) || font.byteLength === 0) {
    throw new TypeError('Vufra requires font data as a nonempty Uint8Array / Buffer');
  }
  const paragraphs = document.paragraphs ?? [];
  const rows = document.rows ?? [];
  if (!Array.isArray(paragraphs) || !paragraphs.every((item) => typeof item === 'string')) {
    throw new TypeError('document.paragraphs must be an array of strings');
  }
  if (!Array.isArray(rows) || !rows.every((item) => typeof item === 'string')) {
    throw new TypeError('document.rows must be an array of strings');
  }
  return native.renderPdfNative(document.title, paragraphs, rows, font);
}
