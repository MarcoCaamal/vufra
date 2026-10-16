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
/** Raw PNG/JPEG bytes; the image will be embedded in the PDF. */
export interface PdfImage {
  data: Uint8Array;
  /** Reserved on-page bounding box (PDF points). */
  width: number;
  height: number;
  /** contain preserves entire image; cover fills the box and clips overflow. */
  fit?: 'contain' | 'cover';
}
/** An ordered, typed block in Vufra's evolving document AST. */
export type PdfBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string; keepWithNext?: boolean }
  | { type: 'styled-paragraph'; text: string; style: Partial<PdfTextStyle> }
  | { type: 'spacer'; height: number }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'rule' | 'rectangle'; width: number; height: number; color?: string }
  | ({ type: 'image' } & PdfImage)
  | { type: 'image'; image: PdfImage } // compatibility alias for nested inputs
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
  keepWithNext?: boolean; items?: string[]; ordered?: boolean;
  graphic?: {kind:string;width:number;height:number;color:string};
  image?: { data: Uint8Array; width: number; height: number; fit: 'contain' | 'cover' };
};
interface NativePage {
  width: number; height: number; marginTop: number;
  marginBottom: number; marginLeft: number; marginRight: number;
}
export interface PdfCancelSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', callback: () => void, options?: {once?:boolean}): void;
  removeEventListener(type: 'abort', callback: () => void): void;
}
export interface PdfAsyncOptions {
  /** Cancels a running native job cooperatively at Rust checkpoints. */
  signal?: PdfCancelSignal;
}
export interface PdfRenderMeasurement {
  pdf: Uint8Array;
  /** CPU render wall-time measured inside the libuv native worker, milliseconds. */
  renderMs: number;
}
export class PdfRenderCancelledError extends Error {
  readonly code = 'ABORTED' as const;
  constructor() {
    super('Vufra PDF rendering cancelled');
    this.name = 'PdfRenderCancelledError';
  }
}
interface NativeToken {
  cancel(): void;
  readonly isCancelled: boolean;
}
interface NativeBinding {
  PdfCancellationToken: new () => NativeToken;
  renderPdfNative(
    title: string, paragraphs: string[], rows: string[], font: Uint8Array,
    table?: PdfTable, blocks?: NativeBlock[], page?: NativePage
  ): Uint8Array;
  renderPdfAsyncNative(
    title: string, paragraphs: string[], rows: string[], font: Uint8Array,
    table?: PdfTable, blocks?: NativeBlock[], page?: NativePage, token?: NativeToken
  ): Promise<{ pdf: Uint8Array; renderMs: number }>;
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
    let imageCount=0, imageBytes=0;
    blocks = document.blocks.map((block): NativeBlock => {
      if (block?.type === 'paragraph' && typeof block.text === 'string') {
        return { kind: 'paragraph', text: block.text };
      }
      if (block?.type === 'heading' && typeof block.text === 'string' &&
          [1, 2, 3].includes(block.level)) {
        if (block.keepWithNext !== undefined && typeof block.keepWithNext !== 'boolean') {
          throw new TypeError('heading.keepWithNext must be boolean');
        }
        return {kind: 'heading', text:block.text, level:block.level,
          keepWithNext:block.keepWithNext ?? true};
      }
      if (block?.type === 'styled-paragraph' && typeof block.text === 'string') {
        return {kind: 'styled-paragraph', text:block.text, style:normalizeStyle(block.style)};
      }
      if (block?.type === 'spacer' && typeof block.height === 'number' &&
          Number.isFinite(block.height) && block.height > 0) {
        return {kind: 'spacer', height:block.height};
      }
      if (block?.type === 'list') {
        if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 1000 ||
            !block.items.every(item => typeof item === 'string' && !!item.trim()) ||
            (block.ordered !== undefined && typeof block.ordered !== 'boolean')) {
          throw new TypeError('list requires 1..1000 nonempty string items and optional ordered boolean');
        }
        return {kind:'list',items:block.items,ordered:block.ordered ?? false};
      }
      if (block?.type === 'rule' || block?.type === 'rectangle') {
        const printableWidth=page ? page.width-page.marginLeft-page.marginRight : 497;
        const printableHeight=page ? page.height-page.marginTop-page.marginBottom : 650;
        if (![block.width,block.height].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0) ||
            block.width>printableWidth || block.height>printableHeight ||
            (block.type==='rule' && block.height>8)) {
          throw new TypeError('graphic dimensions exceed printable area or allowed rule thickness');
        }
        const color=block.color ?? '#333333';
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new TypeError('graphic color must be #RRGGBB');
        return {kind:'graphic',graphic:{kind:block.type,width:block.width,height:block.height,color}};
      }
      if (block?.type === 'image') {
        const image = 'image' in block ? block.image : block;
        if (!image || !(image.data instanceof Uint8Array) || image.data.byteLength < 1 ||
            image.data.byteLength > 8 * 1024 * 1024) {
          throw new TypeError('image.data must be a PNG/JPEG Uint8Array of 1..8 MiB');
        }
        if (![image.width,image.height].every(v=>typeof v==='number' && Number.isFinite(v) && v>0) ||
            image.width > (page ? page.width-page.marginLeft-page.marginRight : 497) ||
            image.height > (page ? page.height-page.marginTop-page.marginBottom : 650)) {
          throw new TypeError('image dimensions must fit within the printable page area');
        }
        if (image.fit !== undefined && image.fit !== 'contain' && image.fit !== 'cover') {
          throw new TypeError('image.fit must be contain or cover');
        }
        imageCount++;
        imageBytes += image.data.byteLength;
        if (imageCount > 64 || imageBytes > 32 * 1024 * 1024) {
          throw new TypeError('too many images or image bytes in document');
        }
        return {kind:'image', image:{data:image.data, width:image.width,
          height:image.height, fit:image.fit ?? 'contain'}};
      }
      if (block?.type === 'table') {
        validateTable(block.table, page ? page.width - page.marginLeft - page.marginRight : 497);
        return { kind: 'table', table: block.table };
      }
      throw new TypeError('invalid flow block type or payload');
    });
  }
  return [document.title, paragraphs, rows, font, table, blocks, page];
}

/** Synchronous native render. Blocks the Node.js event loop until the PDF is ready. */
export function renderPdf(document: PdfDocument, font: Uint8Array): Uint8Array {
  return native.renderPdfNative(...normalizePdf(document, font));
}

/**
 * Generate a PDF on a native libuv worker. Signal aborts both waiting-to-run
 * native tasks and in-progress rendering at cooperative Rust checkpoints.
 * No force-killing of a thread; one third-party shaping call cannot be preempted.
 */
export async function renderPdfAsyncMeasured(
  document: PdfDocument, font: Uint8Array, options: PdfAsyncOptions = {},
): Promise<PdfRenderMeasurement> {
  const args = normalizePdf(document, font);
  const token = new native.PdfCancellationToken();
  const signal = options.signal;
  if (signal?.aborted) throw new PdfRenderCancelledError();
  const cancel = () => token.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) token.cancel();
    const result = await native.renderPdfAsyncNative(...args, token);
    if (!Number.isFinite(result.renderMs) || result.renderMs < 0) {
      throw new Error('Invalid native render time');
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('VUFRA_CANCELLED')) {
      throw new PdfRenderCancelledError();
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/** Same PDF as renderPdf(), with native cooperative cancellation support. */
export async function renderPdfAsync(
  document: PdfDocument, font: Uint8Array, options: PdfAsyncOptions = {},
): Promise<Uint8Array> {
  const result = await renderPdfAsyncMeasured(document, font, options);
  return result.pdf;
}

export { PdfRenderQueue, PdfQueueError } from './queue';
export type { PdfAbortSignal, PdfEnqueueOptions, PdfQueueErrorCode, PdfRenderQueueOptions, PdfRenderQueueStats, PdfJobEvent, PdfJobOutcome } from './queue';
