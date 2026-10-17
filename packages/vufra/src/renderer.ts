
/**
 * Vufra v0.1 — experimental native Rust PDF SDK for Node.js.
 *
 * The caller provides the font as bytes; there is no OS font lookup inside Vufra.
 * Returned bytes are a standard PDF. Text shaping is currently limited to
 * Latin-script test cases with no advanced bidi/fallback guarantee.
 */
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
export type PdfRowItem =
  | { type: 'text'; text: string; style?: Partial<PdfTextStyle> }
  | { type: 'rich'; runs: PdfRichRun[]; style?: Partial<PdfTextStyle> }
  | { type: 'image'; data: Uint8Array; width: number; height: number; fit?: 'contain' | 'cover' }
  | { type: 'box'; box: PdfBox }
  | { type: 'rule' | 'rectangle'; width: number; height: number; color?: string }
  | { type: 'spacer'; height: number };
export interface PdfRowColumn {
  width: number;
  align?: 'left' | 'right';
  items: PdfRowItem[];
}
export interface PdfRow {
  gap?: number;
  columns: PdfRowColumn[];
}
/** Rich table rendered inside a decorated box; rows remain atomic across pages. */
export interface PdfBoxTable {
  header: PdfRow;
  rows: PdfRow[];
  /** Backgrounds: header first, then every data row, per column. */
  fills: (string | undefined)[][];
}
export type PdfBoxItem =
  | {type:'text';text:string;style?:Partial<PdfTextStyle>;color?:string}
  | {type:'rich';runs:PdfRichRun[];style?:Partial<PdfTextStyle>}
  | {type:'row';row:PdfRow}
  | {type:'box';box:PdfBox}
  | {type:'table';table:PdfBoxTable}
  | {type:'image';data:Uint8Array;width:number;height:number;fit?:'contain'|'cover'}
  | {type:'rule'|'rectangle';width:number;height:number;color?:string}
  | {type:'spacer';height:number};
export interface PdfBox {
  width?:number;
  align?:'left'|'center'|'right';
  padding?:number;
  background?:string;
  border?:{width?:number;color?:string};
  keepTogether?:boolean;
  breakBefore?:boolean;
  keepWithNext?:boolean;
  items:PdfBoxItem[];
}
export interface PdfRichRun {
  /** Text is drawn using a real embedded font file, not artificial bold/italic. */
  text: string;
  /** 'regular' references the required second argument; other names resolve in fontFaces. */
  font?: string;
  /** Font size for this run, in PDF points (6..36). */
  fontSize?: number;
  /** Hex RGB text fill for this run; default black. */
  color?: string;
  /** Ordered font face IDs to use if the primary font cannot cover a whole word. */
  fallbackFonts?: string[];
}
/** An ordered, typed block in Vufra's evolving document AST. */
export type PdfBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string; keepWithNext?: boolean }
  | { type: 'styled-paragraph'; text: string; style: Partial<PdfTextStyle> }
  | { type: 'rich-paragraph'; runs: PdfRichRun[]; style?: Partial<PdfTextStyle>; keepWithNext?: boolean }
  | { type: 'spacer'; height: number }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'rule' | 'rectangle'; width: number; height: number; color?: string }
  | ({ type: 'image' } & PdfImage)
  | { type: 'row'; row: PdfRow }
  | { type: 'box'; box: PdfBox }
  | { type: 'page-break' };

/** Repeating page bands. Text may contain {{page}} and {{total}} placeholders. */
export interface PdfPageChrome {
  header?: PdfRow;
  footer?: PdfRow;
  firstHeader?: PdfRow;
  firstFooter?: PdfRow;
  hideHeader?: boolean;
  hideFooter?: boolean;
  hideFirstHeader?: boolean;
  hideFirstFooter?: boolean;
}
export interface PdfDocument {
  /** Shown in the running header. Required, nonempty. */
  title: string;
  /** A single ordered semantic content flow. */
  blocks: PdfBlock[];
  /** Page geometry: A4, Letter, or custom dimensions and margins. */
  page?: PdfPageOptions;
  /** Named TTF/OTF font bytes for rich text; reserved name: regular. Max 6 extra fonts. */
  fontFaces?: Record<string, Uint8Array>;
  /** Optional repeated page headers and footers. */
  pageChrome?: PdfPageChrome;
}

type NativeBlock = {
  kind: string; text?: string;
  runs?: {text:string;font:string;fontSize?:number;color?:string;fallbackFonts?:string[]}[];
  level?: number; style?: PdfTextStyle; height?: number;
  keepWithNext?: boolean; items?: string[]; ordered?: boolean;
  graphic?: {kind:string;width:number;height:number;color:string};
  image?: { data: Uint8Array; width: number; height: number; fit: 'contain' | 'cover' };
  boxData?: {width?:number;align:string;padding:number;borderWidth:number;
    borderColor?:string;background?:string;
    keepTogether?:boolean;breakBefore?:boolean;keepWithNext?:boolean;items:Array<{
      kind:string;text?:string;style?:PdfTextStyle;color?:string;height?:number;
      runs?:{text:string;font:string;fontSize?:number;color?:string;fallbackFonts?:string[]}[];
      row?:NativeBlock['row'];
      tableData?:{header:NonNullable<NativeBlock['row']>;rows:NonNullable<NativeBlock['row']>[];
        fills:(string|undefined)[][]};
      boxData?:NonNullable<NativeBlock['boxData']>;
      image?:{data:Uint8Array;width:number;height:number;fit:'contain'|'cover'};
      graphic?:{kind:string;width:number;height:number;color:string}
    }>};
  row?: {gap:number;columns:Array<{width:number;rightAlign:boolean;items:Array<{
    kind:string;text?:string;style?:PdfTextStyle;height?:number;
    runs?:{text:string;font:string;fontSize?:number;color?:string;fallbackFonts?:string[]}[];
    image?: {data:Uint8Array;width:number;height:number;fit:'contain'|'cover'};
    boxData?:NonNullable<NativeBlock['boxData']>;
    graphic?: {kind:string;width:number;height:number;color:string}
  }>}>};
};
interface NativeChrome {
  header?: NonNullable<NativeBlock['row']>;
  footer?: NonNullable<NativeBlock['row']>;
  firstHeader?: NonNullable<NativeBlock['row']>;
  firstFooter?: NonNullable<NativeBlock['row']>;
  hideHeader?: boolean;
  hideFooter?: boolean;
  hideFirstHeader?: boolean;
  hideFirstFooter?: boolean;
}
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
interface NativeFontFace {name:string;data:Uint8Array}
interface NativeBinding {
  PdfCancellationToken: new () => NativeToken;
  renderPdfNative(
    title:string,blocks:NativeBlock[],font:Uint8Array,page?:NativePage,
    fontFaces?:NativeFontFace[],chrome?:NativeChrome
  ):Uint8Array;
  renderPdfAsyncNative(
    title:string,blocks:NativeBlock[],font:Uint8Array,page?:NativePage,
    token?:NativeToken,fontFaces?:NativeFontFace[],chrome?:NativeChrome
  ):Promise<{pdf:Uint8Array;renderMs:number}>;
}
declare const require: (path: string) => NativeBinding;

// Built locally from bindings/vufra-node; published platform binaries are a future task.
const native: NativeBinding = require('../native/vufra.node');

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

type NativeArguments=[
  title:string,blocks:NativeBlock[],font:Uint8Array,
  page?:NativePage,fontFaces?:NativeFontFace[],chrome?:NativeChrome
];

/** Shared preflight/normalization for both the synchronous and asynchronous API. */
function normalizePdf(document: PdfDocument, font: Uint8Array): NativeArguments {
  if (!document || typeof document.title !== 'string' || !document.title.trim()) {
    throw new TypeError('Vufra requires a nonempty document.title');
  }
  if (!(font instanceof Uint8Array) || font.byteLength === 0) {
    throw new TypeError('Vufra requires font data as a nonempty Uint8Array / Buffer');
  }
  if(!Array.isArray(document.blocks))
    throw new TypeError('document.blocks must be an array');
  const page = document.page === undefined ? undefined : normalizePage(document.page);
  const faceEntries = Object.entries(document.fontFaces ?? {});
  if (faceEntries.length > 6) throw new TypeError('fontFaces supports a maximum of six additional fonts');
  let totalFontBytes=0;
  const fontFaces: NativeFontFace[] = faceEntries.map(([name,data])=>{
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(name) || name==='regular') {
      throw new TypeError('fontFaces names must be unique ASCII identifiers other than regular');
    }
    if (!(data instanceof Uint8Array) || data.byteLength===0 || data.byteLength>12*1024*1024) {
      throw new TypeError('fontFaces require nonempty TTF/OTF bytes up to 12 MiB per face');
    }
    totalFontBytes+=data.byteLength;
    if(totalFontBytes>30*1024*1024)throw new TypeError('fontFaces exceed 30 MiB total');
    return {name,data};
  });
  let normalizedChrome: NativeChrome | undefined;
  let blocks:NativeBlock[];
  {
    let imageCount=0, imageBytes=0;
    const normalizeNestedRich=(runs:PdfRichRun[],style?:Partial<PdfTextStyle>)=>{
      if(!Array.isArray(runs)||runs.length===0||runs.length>1000)
        throw new TypeError('nested rich text requires 1..1000 runs');
      const faces=new Set(['regular',...fontFaces.map(f=>f.name)]);
      const normalized=runs.map(r=>{
        if(!r||typeof r.text!=='string'||!r.text||typeof (r.font??'regular')!=='string'||
          !faces.has(r.font??'regular')||
          (r.fontSize!==undefined&&(!Number.isFinite(r.fontSize)||r.fontSize<6||r.fontSize>36))||
          (r.color!==undefined&&!/^#[0-9a-fA-F]{6}$/.test(r.color))||
          (r.fallbackFonts!==undefined&&(!Array.isArray(r.fallbackFonts)||r.fallbackFonts.length>6||
            !r.fallbackFonts.every(f=>faces.has(f)))))
          throw new TypeError('nested rich text references invalid font, color or run');
        return {text:r.text,font:r.font??'regular',fontSize:r.fontSize,color:r.color,
          fallbackFonts:r.fallbackFonts};
      });
      return {runs:normalized,style:normalizeStyle(style??{spaceBefore:4,spaceAfter:3})};
    };
    const normalizeRow=(row:PdfRow,printableWidth:number,printableHeight:number,
      depth=0):NonNullable<NativeBlock['row']>=>{
    if (!row || !Array.isArray(row.columns) ||
          row.columns.length<1 || row.columns.length>6 ||
          !Number.isFinite(row.gap ?? 0) || (row.gap ?? 0)<0 || (row.gap ?? 0)>80) {
          throw new TypeError('row requires 1..6 columns and gap 0..80 points');
        }
        let totalWidth=(row.columns.length-1)*(row.gap??0);
        const columns=row.columns.map(col=>{
          if (!col || !Number.isFinite(col.width) || col.width<60 ||
              !Array.isArray(col.items) || col.items.length>50 ||
              (col.align!==undefined && !['left','right'].includes(col.align))) {
            throw new TypeError('row columns require width >= 60, valid align and <=50 items');
          }
          totalWidth+=col.width;
          const items=col.items.map(item=>{
            if(item?.type==='box'){
              return {kind:'box',boxData:normalizeBox(item.box,col.width,printableHeight,depth+1)};
            }
            if(item?.type==='rich'){
              const nested=normalizeNestedRich(item.runs,item.style);
              return {kind:'rich',...nested};
            }
            if(item?.type==='text' && typeof item.text==='string'){
              return {kind:'text',text:item.text,style:normalizeStyle(
                item.style ?? {spaceBefore:4,spaceAfter:3})};
            }
            if(item?.type==='spacer' && Number.isFinite(item.height) && item.height>0 &&
                item.height<=printableHeight) return {kind:'spacer',height:item.height};
            if(item?.type==='image'){
              if(!(item.data instanceof Uint8Array) || item.data.length===0 ||
                  item.data.length>8*1024*1024 || !Number.isFinite(item.width) ||
                  !Number.isFinite(item.height) || item.width<=0 || item.height<=0 ||
                  item.width>col.width || item.height>printableHeight ||
                  !['contain','cover',undefined].includes(item.fit)) {
                throw new TypeError('invalid row image format, data or dimensions');
              }
              imageCount++;imageBytes+=item.data.byteLength;
              if(imageCount>64 || imageBytes>32*1024*1024) {
                throw new TypeError('too many images or image bytes in document');
              }
              return {kind:'image',image:{data:item.data,width:item.width,
                height:item.height,fit:item.fit??'contain'}};
            }
            if(item?.type==='rule' || item?.type==='rectangle'){
              const color=item.color??'#333333';
              if(!Number.isFinite(item.width)||!Number.isFinite(item.height)||
                item.width<=0||item.height<=0||item.width>col.width||
                item.height>printableHeight||(item.type==='rule'&&item.height>8)||
                !/^#[0-9a-fA-F]{6}$/.test(color)) {
                throw new TypeError('invalid row graphic dimensions or color');
              }
              return {kind:'graphic',graphic:{kind:item.type,width:item.width,
                height:item.height,color}};
            }
            throw new TypeError('unsupported or invalid row column item');
          });
          return {width:col.width,rightAlign:col.align==='right',items};
        });
        if(totalWidth>printableWidth+0.02){
          throw new TypeError('row columns exceed printable width');
        }
        return {gap:row.gap??0,columns};
    };
    const normalizeBox=(boxed:PdfBox,printableWidth:number,
      printableHeight:number,depth=0):NonNullable<NativeBlock['boxData']>=>{
      if(depth>8)throw new TypeError('nested box depth exceeds 8');
        const innerWidth=(boxed?.width ?? printableWidth)-2*(boxed?.padding??12);
        const padding=boxed?.padding??12;
        const borderWidth=boxed?.border?.width??0;
        if (!boxed || !Array.isArray(boxed.items) || boxed.items.length<1 ||
            boxed.items.length>500 ||
            !Number.isFinite(padding) || padding<0 || padding>60 ||
            !Number.isFinite(borderWidth) || borderWidth<0 || borderWidth>6 ||
            borderWidth>padding ||
            !Number.isFinite(boxed.width??printableWidth) ||
            (boxed.width??printableWidth)<100 ||
            (boxed.width??printableWidth)>printableWidth ||
            innerWidth<60 ||
            (boxed.align!==undefined&&!['left','center','right'].includes(boxed.align))) {
          throw new TypeError('invalid box geometry, padding, border, alignment or item count');
        }
        const rgb=(value:string|undefined):string|undefined=>{
          if(value!==undefined && !/^#[0-9a-fA-F]{6}$/.test(value))
            throw new TypeError('box colors must be #RRGGBB');
          return value;
        };
        if([boxed.keepTogether,boxed.breakBefore,boxed.keepWithNext].some(x=>x!==undefined && typeof x!=='boolean')){
          throw new TypeError('box page policies must be boolean');
        }
        const items=boxed.items.map(item=>{
          if(item?.type==='rich'){
            return {kind:'rich',...normalizeNestedRich(item.runs,item.style)};
          }
          if(item?.type==='box'){
            return {kind:'box',boxData:normalizeBox(item.box,innerWidth,
              printableHeight-2*padding,depth+1)};
          }
          if(item?.type==='row'){
            return {kind:'row',row:normalizeRow(item.row,innerWidth,printableHeight-2*padding,depth+1)};
          }
          if(item?.type==='table'){
            const t=item.table;
            if(!t || !Array.isArray(t.rows) || !t.rows.length || t.rows.length>1000 ||
               !Array.isArray(t.fills) || t.fills.length!==t.rows.length+1) {
              throw new TypeError('boxed table requires 1..1000 rows and fills');
            }
            const header=normalizeRow(t.header,innerWidth,printableHeight-2*padding,depth+1);
            const rows=t.rows.map(r=>normalizeRow(r,innerWidth,printableHeight-2*padding,depth+1));
            if(header.gap!==0 || header.columns.length>6 || rows.some(r=>
              r.gap!==0 || r.columns.length!==header.columns.length ||
              r.columns.some((c,i)=>Math.abs(c.width-header.columns[i].width)>0.01))) {
              throw new TypeError('boxed table must share contiguous 1..6 column widths');
            }
            const fills=t.fills.map(f=>{
              if(!Array.isArray(f) || f.length!==header.columns.length)
                throw new TypeError('boxed table fills must match column count');
              return f.map(rgb);
            });
            return {kind:'table',tableData:{header,rows,fills}};
          }
          if(item?.type==='text' && typeof item.text==='string'){
            return {kind:'text',text:item.text,style:normalizeStyle(
              item.style??{spaceBefore:4,spaceAfter:3}),color:rgb(item.color)};
          }
          if(item?.type==='spacer' && Number.isFinite(item.height) &&
            item.height>0 && item.height+padding*2<=printableHeight) {
            return {kind:'spacer',height:item.height};
          }
          if(item?.type==='image') {
            if (!(item.data instanceof Uint8Array)||item.data.byteLength<1 ||
                item.data.byteLength>8*1024*1024 ||
                !Number.isFinite(item.width)||!Number.isFinite(item.height) ||
                item.width<=0||item.height<=0||
                item.width>innerWidth||item.height+padding*2>printableHeight ||
                !['contain','cover',undefined].includes(item.fit)) {
              throw new TypeError('invalid box image or image exceeds content size');
            }
            imageCount++;imageBytes+=item.data.byteLength;
            if(imageCount>64||imageBytes>32*1024*1024){
              throw new TypeError('too many images or image bytes in document');
            }
            return {kind:'image',image:{data:item.data,width:item.width,
              height:item.height,fit:item.fit??'contain'}};
          }
          if(item?.type==='rule'||item?.type==='rectangle'){
            if(!Number.isFinite(item.width)||!Number.isFinite(item.height)||
              item.width<=0||item.height<=0||item.width>innerWidth||
              item.height+padding*2>printableHeight||
              (item.type==='rule'&&item.height>8)) {
              throw new TypeError('invalid box graphic dimensions');
            }
            return {kind:'graphic',graphic:{kind:item.type,width:item.width,
              height:item.height,color:rgb(item.color)??'#333333'}};
          }
          throw new TypeError('unsupported or invalid box item');
        });
        return {
          width:boxed.width,align:boxed.align??'left',padding,
          borderWidth,borderColor:rgb(boxed.border?.color),
          background:rgb(boxed.background),keepTogether:boxed.keepTogether,
          breakBefore:boxed.breakBefore,keepWithNext:boxed.keepWithNext,items
        };
    };
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
      if (block?.type === 'rich-paragraph') {
        if (!Array.isArray(block.runs) || !block.runs.length || block.runs.length>1000 ||
            !block.runs.every(run => run && typeof run.text==='string' && !!run.text &&
              typeof (run.font ?? 'regular')==='string' &&
              (run.font ?? 'regular')!=='') ) {
          throw new TypeError('rich-paragraph requires 1..1000 nonempty text runs');
        }
        const names=new Set(['regular',...fontFaces.map(f=>f.name)]);
        if(!block.runs.every(r=>names.has(r.font ?? 'regular'))) {
          throw new TypeError('rich-paragraph references unknown font face');
        }
        for (const r of block.runs) {
          if (r.fontSize!==undefined &&
            (typeof r.fontSize!=='number' || !Number.isFinite(r.fontSize) ||
              r.fontSize<6 || r.fontSize>36)) {
            throw new TypeError('rich text fontSize must be 6..36 points');
          }
          if (r.color!==undefined &&
            (typeof r.color!=='string' || !/^#[0-9a-fA-F]{6}$/.test(r.color))) {
            throw new TypeError('rich text color must be #RRGGBB');
          }
          if (r.fallbackFonts!==undefined &&
            (!Array.isArray(r.fallbackFonts) || r.fallbackFonts.length>6 ||
              !r.fallbackFonts.every(f=>typeof f==='string' && names.has(f)))) {
            throw new TypeError('rich text fallbackFonts must list up to six known font faces');
          }
        }
        return {kind:'rich-paragraph',keepWithNext:block.keepWithNext??false,runs:block.runs.map(r=>({
          text:r.text,font:r.font ?? 'regular',
          fontSize:r.fontSize, color:r.color, fallbackFonts:r.fallbackFonts
        })),style:normalizeStyle(block.style ?? {})};
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
        const image=block;
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
      if(block?.type==='box'){
        const w=page?page.width-page.marginLeft-page.marginRight:497;
        const h=page?page.height-page.marginTop-page.marginBottom:650;
        return {kind:'box',boxData:normalizeBox(block.box,w,h)};
      }
      if (block?.type === 'page-break') return {kind:'page-break'};
      if(block?.type==='row'){
        const w=page?page.width-page.marginLeft-page.marginRight:497;
        const h=page?page.height-page.marginTop-page.marginBottom:650;
        return {kind:'row',row:normalizeRow(block.row,w,h)};
      }
      throw new TypeError('invalid flow block type or payload');
    });
    if (document.pageChrome !== undefined) {
      const chrome = document.pageChrome;
      if (!chrome || typeof chrome !== 'object' || Array.isArray(chrome)) {
        throw new TypeError('pageChrome must be an object');
      }
      const keys = ['header','footer','firstHeader','firstFooter'] as const;
      const flags = ['hideHeader','hideFooter','hideFirstHeader','hideFirstFooter'] as const;
      normalizedChrome = {};
      for (const name of keys) {
        if (chrome[name] !== undefined) {
          normalizedChrome[name] = normalizeRow(chrome[name]!,
            page ? page.width-page.marginLeft-page.marginRight : 497,
            page ? page.height-24 : 818);
        }
      }
      for (const flag of flags) {
        if (chrome[flag] !== undefined) {
          if (typeof chrome[flag] !== 'boolean') {
            throw new TypeError('pageChrome hide flags must be boolean');
          }
          normalizedChrome[flag] = chrome[flag];
        }
      }
      if ((chrome.header && chrome.hideHeader) || (chrome.footer && chrome.hideFooter) ||
          (chrome.firstHeader && chrome.hideFirstHeader) ||
          (chrome.firstFooter && chrome.hideFirstFooter)) {
        throw new TypeError('pageChrome cannot both hide and define the same band');
      }
    }
  }
  return [document.title,blocks,font,page,fontFaces,normalizedChrome];
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
    const [title,blocks,regular,page,faces,chrome]=args;
    const result=await native.renderPdfAsyncNative(
      title,blocks,regular,page,token,faces,chrome
    );
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
