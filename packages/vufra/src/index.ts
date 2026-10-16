/**
 * Vufra v0.1 — experimental native Rust PDF SDK for Node.js.
 *
 * The caller provides the font as bytes; there is no OS font lookup inside Vufra.
 * Returned bytes are a standard PDF. Text shaping is currently limited to
 * Latin-script test cases with no advanced bidi/fallback guarantee.
 */
export interface PdfColumn {
  /** Label repeated at the top of every table page. */
  header: string;
  /** Width in PDF points. 1 point = 1/72 inch; total widths <= 497pt on A4. */
  width: number;
}

export interface PdfTable {
  /** Between 1 and 12 columns. */
  columns: PdfColumn[];
  /** Each row contains exactly one string per column. */
  rows: string[][];
}

/** An ordered paragraph or table. Subsequent blocks reuse remaining page space. */
export type PdfBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'table'; table: PdfTable };

export interface PdfDocument {
  /** Shown in the running header. Required, nonempty. */
  title: string;
  /** Paragraphs in the desired order before table rows. */
  paragraphs?: string[];
  /** A table-like list of rows; repeated headers and pagination are automatic. */
  rows?: string[];
  /** Legacy real multi-column table, placed on new pages after paragraphs and legacy rows. */
  table?: PdfTable;
  /** Ordered flow mode; do not combine with legacy paragraphs, rows or table. */
  blocks?: PdfBlock[];
}

type NativeBlock = { kind: string; text?: string; table?: PdfTable };
interface NativeBinding {
  renderPdfNative(
    title: string, paragraphs: string[], rows: string[], font: Uint8Array,
    table?: PdfTable, blocks?: NativeBlock[]
  ): Uint8Array;
}
declare const require: (path: string) => NativeBinding;

// Built locally from bindings/vufra-node; published platform binaries are a future task.
const native: NativeBinding = require('../native/vufra.node');

function validateTable(table: PdfTable): void {
  if (!table || !Array.isArray(table.columns) || table.columns.length < 1 || table.columns.length > 12 ||
      !Array.isArray(table.rows)) {
    throw new TypeError('document.table requires columns (1-12) and rows arrays');
  }
  if (!table.columns.every(c => c && typeof c.header === 'string' && !!c.header.trim() &&
      typeof c.width === 'number' && Number.isFinite(c.width) && c.width >= 36) ||
      table.columns.reduce((sum, c) => sum + c.width, 0) > 497) {
    throw new TypeError('document.table columns require valid headers and widths (total <= 497pt)');
  }
  if (!table.rows.every(row => Array.isArray(row) && row.length === table.columns.length &&
      row.every(cell => typeof cell === 'string'))) {
    throw new TypeError('document.table rows must contain one string per column');
  }
}

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
  const table = document.table;
  if (table !== undefined) validateTable(table);
  let blocks: NativeBlock[] | undefined;
  if (document.blocks !== undefined) {
    if (!Array.isArray(document.blocks)) throw new TypeError('document.blocks must be an array');
    if (paragraphs.length > 0 || rows.length > 0 || table !== undefined) {
      throw new TypeError('document.blocks cannot be combined with legacy paragraphs/rows/table');
    }
    blocks = document.blocks.map((block): NativeBlock => {
      if (block?.type === 'paragraph' && typeof block.text === 'string') {
        return { kind: 'paragraph', text: block.text };
      }
      if (block?.type === 'table') {
        validateTable(block.table);
        return { kind: 'table', table: block.table };
      }
      throw new TypeError('flow block must be a paragraph or a table');
    });
  }
  return native.renderPdfNative(document.title, paragraphs, rows, font, table, blocks);
}
