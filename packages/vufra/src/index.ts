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

/** Points are 1/72 inch. Values are explicit for predictable document layout. */
export interface PdfTextStyle {
  fontSize: number;
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
}
export interface PdfPageOptions {
  /** A4 default, US Letter, or custom width+height in points. */
  format?: 'a4' | 'letter';
  width?: number;
  height?: number;
  margins?: Partial<{ top: number; bottom: number; left: number; right: number }>;
}
/** An ordered, typed block in Vufra's evolving document AST. */
export type PdfBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'styled-paragraph'; text: string; style: Partial<PdfTextStyle> }
  | { type: 'spacer'; height: number }
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
  /** Flow-only page geometry: A4, Letter, custom dimensions and margins. */
  page?: PdfPageOptions;
}

type NativeBlock = {
  kind: string; text?: string; table?: PdfTable;
  level?: number; style?: PdfTextStyle; height?: number;
};
interface NativePage {
  width: number; height: number; marginTop: number;
  marginBottom: number; marginLeft: number; marginRight: number;
}
interface NativeBinding {
  renderPdfNative(
    title: string, paragraphs: string[], rows: string[], font: Uint8Array,
    table?: PdfTable, blocks?: NativeBlock[], page?: NativePage
  ): Uint8Array;
  renderPdfAsyncNative(
    title: string, paragraphs: string[], rows: string[], font: Uint8Array,
    table?: PdfTable, blocks?: NativeBlock[], page?: NativePage
  ): Promise<Uint8Array>;
}
declare const require: (path: string) => NativeBinding;

// Built locally from bindings/vufra-node; published platform binaries are a future task.
const native: NativeBinding = require('../native/vufra.node');

function validateTable(table: PdfTable, contentWidth = 497): void {
  if (!table || !Array.isArray(table.columns) || table.columns.length < 1 || table.columns.length > 12 ||
      !Array.isArray(table.rows)) {
    throw new TypeError('document.table requires columns (1-12) and rows arrays');
  }
  if (!table.columns.every(c => c && typeof c.header === 'string' && !!c.header.trim() &&
      typeof c.width === 'number' && Number.isFinite(c.width) && c.width >= 36) ||
      table.columns.reduce((sum, c) => sum + c.width, 0) > contentWidth + 0.01) {
    throw new TypeError('document.table columns require valid headers and widths within page content width');
  }
  if (!table.rows.every(row => Array.isArray(row) && row.length === table.columns.length &&
      row.every(cell => typeof cell === 'string'))) {
    throw new TypeError('document.table rows must contain one string per column');
  }
}

const defaultTextStyle: PdfTextStyle = {
  fontSize: 11, lineHeight: 16, spaceBefore: 17, spaceAfter: 9,
};

function normalizePage(page: PdfPageOptions): NativePage {
  if (!page || (page.format !== undefined && !['a4', 'letter'].includes(page.format))) {
    throw new TypeError('page.format must be a4 or letter');
  }
  const preset = page.format === 'letter' ? {width:612,height:792} : {width:595,height:842};
  if ((page.width === undefined) !== (page.height === undefined)) {
    throw new TypeError('custom page requires both width and height');
  }
  const margins = page.margins ?? {};
  const result = {
    width:page.width ?? preset.width, height:page.height ?? preset.height,
    marginTop:margins.top ?? 120, marginBottom:margins.bottom ?? 72,
    marginLeft:margins.left ?? 49, marginRight:margins.right ?? 49,
  };
  if (Object.values(result).some(v=>!Number.isFinite(v)) ||
      result.width < 250 || result.height < 250 || result.width > 2000 || result.height > 2000 ||
      result.marginTop < 110 || result.marginBottom < 50 ||
      result.marginLeft < 20 || result.marginRight < 20 ||
      result.width - result.marginLeft - result.marginRight < 100 ||
      result.height - result.marginTop - result.marginBottom < 100) {
    throw new TypeError('invalid page geometry or margins');
  }
  return result;
}

function normalizeStyle(style: Partial<PdfTextStyle>): PdfTextStyle {
  if (!style || typeof style !== 'object') throw new TypeError('invalid paragraph style');
  const resolved = { ...defaultTextStyle, ...style };
  if (!Object.values(resolved).every(v=>typeof v === 'number' && Number.isFinite(v)) ||
      resolved.fontSize < 6 || resolved.fontSize > 36 ||
      resolved.lineHeight < resolved.fontSize || resolved.lineHeight > 60 ||
      resolved.spaceBefore < 0 || resolved.spaceAfter < 0) {
    throw new TypeError('invalid paragraph style');
  }
  return resolved;
}

type NativeArguments = [
  title: string, paragraphs: string[], rows: string[], font: Uint8Array,
  table?: PdfTable, blocks?: NativeBlock[], page?: NativePage,
];

/** Shared preflight/normalization for both the synchronous and asynchronous API. */
function normalizePdf(document: PdfDocument, font: Uint8Array): NativeArguments {
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
  const page = document.page === undefined ? undefined : normalizePage(document.page);
  if (page !== undefined && document.blocks === undefined) {
    throw new TypeError('page geometry requires blocks mode');
  }
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
      if (block?.type === 'heading' && typeof block.text === 'string' &&
          [1, 2, 3].includes(block.level)) {
        return {kind: 'heading', text:block.text, level:block.level};
      }
      if (block?.type === 'styled-paragraph' && typeof block.text === 'string') {
        return {kind: 'styled-paragraph', text:block.text, style:normalizeStyle(block.style)};
      }
      if (block?.type === 'spacer' && typeof block.height === 'number' &&
          Number.isFinite(block.height) && block.height > 0) {
        return {kind: 'spacer', height:block.height};
      }
      if (block?.type === 'table') {
        validateTable(block.table, page ? page.width - page.marginLeft - page.marginRight : 497);
        return { kind: 'table', table: block.table };
      }
      throw new TypeError('flow block must be a paragraph or a table');
    });
  }
  return [document.title, paragraphs, rows, font, table, blocks, page];
}

/** Synchronous native render. Blocks the Node.js event loop until the PDF is ready. */
export function renderPdf(document: PdfDocument, font: Uint8Array): Uint8Array {
  return native.renderPdfNative(...normalizePdf(document, font));
}

/**
 * Generate a PDF on a native libuv worker, returning a Promise of PDF bytes.
 * The document and font are copied/owned by the native job before it is queued.
 * Suitable for NestJS request handlers: `await renderPdfAsync(doc, font)`.
 *
 * No cancellation or streaming in this prototype. Large concurrent jobs use
 * the libuv worker pool and consume memory; apply app-level concurrency limits.
 */
export async function renderPdfAsync(
  document: PdfDocument, font: Uint8Array,
): Promise<Uint8Array> {
  return native.renderPdfAsyncNative(...normalizePdf(document, font));
}

export { PdfRenderQueue, PdfQueueError } from './queue';
export type { PdfAbortSignal, PdfEnqueueOptions, PdfQueueErrorCode, PdfRenderQueueOptions, PdfRenderQueueStats } from './queue';
