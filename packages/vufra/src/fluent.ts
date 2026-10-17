/**
 * Vufra's primary, progressive PDF authoring API (Unit 14).
 *
 * Builders are immutable. Scoped callback builders are mutable ONLY inside the
 * callback, then sealed; both produce the same low-level AST used by the native
 * renderer. No implicit font lookup or hidden browser.
 */
import { renderPdf, renderPdfAsync, type PdfAsyncOptions, type PdfBlock,
  type PdfDocument, type PdfPageOptions, type PdfBox, type PdfBoxItem, type PdfRow, type PdfRowColumn,
  type PdfRowItem, type PdfRichRun, type PdfTable, type PdfTextStyle, type PdfPageChrome, type PdfBoxTable
} from './index';
import { PdfRenderQueue, type PdfEnqueueOptions } from './queue';
declare const structuredClone: <T>(value:T)=>T;

export type Color = string;
export interface VufraStyle {
  fontSize?: number;
  lineHeight?: number;
  color?: Color;
  font?: string;
  bold?: boolean;
  spaceBefore?: number;
  spaceAfter?: number;
}
export interface VufraTheme {
  colors?: Record<string, string>;
  text?: VufraStyle;
  h1?: VufraStyle;
  h2?: VufraStyle;
  h3?: VufraStyle;
}
export interface VufraConfig {
  font?: Uint8Array;
  fonts?: Record<string, Uint8Array>;
  theme?: VufraTheme;
}
export interface DocumentOptions extends VufraConfig {
  title?: string;
  page?: 'A4' | 'Letter' | PdfPageOptions;
  /** Page geometry still reserves a fixed header/footer area. */
  margins?: Partial<{top:number;bottom:number;left:number;right:number}>;
}
export interface HeadingOptions extends VufraStyle {
  level?: 1 | 2 | 3;
  keepWithNext?: boolean;
}
export interface TableColumn<T> {
  key: keyof T & string;
  title?: string;
  width?: number | '*';
}
export interface TableOptions<T> {
  columns?: TableColumn<T>[];
  /** Existing native table automatically stripes and repeats headers. */
  striped?: boolean;
  repeatHeader?: boolean;
}
/** Tokens resolved by Rust once the final page count is known; not JS per-page callbacks. */
export interface PageNumberTokens { page: string; total: string }
export type PageBandText = string | ((tokens:PageNumberTokens)=>string);
/** A table cell may carry a full sequence of spans with genuine embedded fonts. */
export type StyledTableCell = string | number | {
  /** Cell content: choose text, rich runs or a raster image. */
  image?: Uint8Array;
  width?: number;
  height?: number;
  fit?: 'contain'|'cover';
  text?: string;
  runs?: Array<{text:string;bold?:boolean;font?:string;color?:string;fontSize?:number}>;
  bold?: boolean;
  font?: string;
  color?: string;
  fontSize?: number;
  background?: string;
  align?: 'left'|'right';
};
export interface StyledTableColumn {
  title: string;
  width?: number | '*' | `${number}%`;
  align?: 'left' | 'right';
  background?: string;
  color?: string;
}
export interface StyledTableOptions {
  columns: StyledTableColumn[];
  /** Repeated on continuation pages. Always true in Unit18. */
  repeatHeader?: true;
}
export interface RowOptions { gap?: number }
export interface ColumnOptions { width?: number | `${number}%` | '*'; align?: 'left' | 'right' }
export interface GridOptions { columns: number; gap?: number }
export interface ImageOptions { width:number; height:number; fit?: 'contain'|'cover' }
export interface DividerOptions {height?:number;color?:string;width?:number}
export interface BoxOptions {
  width?:number;
  align?:'left'|'center'|'right';
  padding?:number;
  background?:string;
  border?:{width?:number;color?:string};
  /** Refuse fragmentation; returns an error if the entire box exceeds one page. */
  keepTogether?:boolean;
  /** Start this box on the next page unless already at a page boundary. */
  breakBefore?:boolean;
  /** Keep the box and the first fragment of its successor together when possible. */
  keepWithNext?:boolean;
}

/**
 * One portable declarative component. Fluent is still the primary interface;
 * these nodes can be assembled in ordinary TypeScript functions and inserted
 * with .add(), independently of the eventual container width.
 */
export type VufraNode =
  | {kind:'paragraph';text:string;style?:VufraStyle}
  | {kind:'heading';text:string;options?:HeadingOptions}
  | {kind:'image';data:Uint8Array;options:ImageOptions}
  | {kind:'box';options:BoxOptions;children:readonly VufraNode[]}
  | {kind:'flow';children:readonly VufraNode[]}
  | {kind:'table';rows:readonly (readonly StyledTableCell[])[];options:StyledTableOptions}
  | {kind:'grid';options:GridOptions;cells:readonly (readonly VufraNode[])[]}
  | {kind:'row';options:RowOptions;columns:readonly VufraColumnNode[]};
export type VufraChildren=VufraNode|readonly VufraNode[];
export interface VufraColumnNode {
  options:ColumnOptions;
  children:readonly VufraNode[];
}
function nodes(children:VufraChildren):readonly VufraNode[]{
  return Array.isArray(children)?children:[children as VufraNode];
}
/** Catch cycles and unbounded component trees before mutating any builder. */
function validateNodes(children:VufraChildren):void {
  const parents=new Set<object>();
  let count=0;
  const walk=(values:VufraChildren,depth:number):void=>{
    if(depth>32)fail('component tree depth exceeds 32');
    const entries=nodes(values);
    if(entries.length>10_000)fail('component node budget exceeded');
    for(const node of entries){
      if(!node||typeof node!=='object'||!('kind' in node))
        fail('invalid content component');
      if(parents.has(node))fail('circular component tree');
      if(++count>10_000)fail('component node budget exceeded');
      parents.add(node);
      switch(node.kind){
        case 'paragraph':case 'heading':case 'image':case 'table':break;
        case 'flow':case 'box':walk(node.children,depth+1);break;
        case 'grid':
          for(const cell of node.cells)walk(cell,depth+1);
          break;
        case 'row':
          for(const col of node.columns)walk(col.children,depth+1);
          break;
        default: fail('unsupported content node');
      }
      parents.delete(node);
    }
  };
  walk(children,0);
}

export function paragraph(text:string,style?:VufraStyle):VufraNode{
  return {kind:'paragraph',text,style};
}
export function heading(text:string,options?:HeadingOptions):VufraNode{
  return {kind:'heading',text,options};
}
export function image(data:Uint8Array,options:ImageOptions):VufraNode{
  return {kind:'image',data,options};
}
export function box(options:BoxOptions,children:VufraChildren):VufraNode{
  return {kind:'box',options,children:nodes(children)};
}
export function flow(children:VufraChildren):VufraNode{
  return {kind:'flow',children:nodes(children)};
}
export function table(
  rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions
):VufraNode{
  return {kind:'table',rows,options};
}
export function column(children:VufraChildren,options:ColumnOptions={}):VufraColumnNode{
  return {options,children:nodes(children)};
}
export function row(options:RowOptions,columns:readonly VufraColumnNode[]):VufraNode{
  return {kind:'row',options,columns};
}
export function grid(options:GridOptions,
  cells:readonly VufraChildren[]):VufraNode{
  return {kind:'grid',options,cells:cells.map(nodes)};
}

function fail(message:string): never { throw new TypeError('Vufra: '+message); }
function plainObject(value:unknown): value is Record<string,unknown> {
  return value!==null && typeof value==='object' && !Array.isArray(value);
}
function optionsObject(value:unknown): value is Record<string,unknown> {
  return plainObject(value);
}
function validNumber(n:unknown): n is number {
  return typeof n==='number' && Number.isFinite(n);
}
function requireSyncResult(value:unknown):void {
  if(plainObject(value) && typeof value.then==='function') {
    fail('layout callbacks must be synchronous; prepare asynchronous data before constructing a document');
  }
}
function pageOptions(options:DocumentOptions):PdfPageOptions {
  const raw=options.page??'A4';
  const page: PdfPageOptions = typeof raw==='string'
    ? {format:raw==='Letter'?'letter':'a4'} : {...raw};
  if(typeof raw==='string' && !['A4','Letter'].includes(raw)) fail('page must be A4 or Letter');
  if(options.margins) {
    if(plainObject(page.margins) && Object.keys(page.margins).length>0){
      fail('margins must be provided only once, as document.margins or page.margins');
    }
    page.margins={...options.margins};
  }
  return page;
}
function area(page:PdfPageOptions):{width:number;height:number} {
  const w=page.width??(page.format==='letter'?612:595);
  const h=page.height??(page.format==='letter'?792:842);
  const m=page.margins??{};
  return {width:w-(m.left??49)-(m.right??49),
    height:h-(m.top??120)-(m.bottom??72)};
}
function colorHex(value:string | undefined, theme:VufraTheme|undefined):string|undefined {
  if(value===undefined) return undefined;
  const resolved=theme?.colors?.[value]??value;
  if(!/^#[0-9a-fA-F]{6}$/.test(resolved)) {
    fail('color "'+value+'" is not #RRGGBB or a configured theme color');
  }
  return resolved;
}
function mergeStyle(theme:VufraTheme|undefined,base:VufraStyle|undefined,
  extra:VufraStyle|undefined):VufraStyle{
  return {...theme?.text,...base,...extra};
}
function faceFor(style:VufraStyle,fonts:Record<string,Uint8Array>):string {
  if(style.bold && style.font && style.font!=='bold') fail('use either font or bold, not both');
  const name=style.bold?'bold':style.font??'regular';
  if(name!=='regular' && !Object.prototype.hasOwnProperty.call(fonts,name)) {
    fail('font "'+name+'" must be configured using a real TTF/OTF file');
  }
  return name;
}
function richStyle(style:VufraStyle):Partial<PdfTextStyle>{
  const size=style.fontSize??11;
  const line=style.lineHeight??Math.max(16,size*1.4);
  return {fontSize:size,lineHeight:line,spaceBefore:style.spaceBefore??12,
    spaceAfter:style.spaceAfter??8};
}
function ensureText(text:unknown):asserts text is string{
  if(typeof text!=='string' || !text.trim()) fail('text must be a nonempty string');
}
function asTable<T extends object>(
 data:readonly T[]|PdfTable,options:TableOptions<T>|undefined,contentWidth:number
):PdfTable {
  if(plainObject(data) && Array.isArray(data.columns) && Array.isArray(data.rows)) {
    if(options?.columns) fail('table column definitions were provided twice');
    return data as unknown as PdfTable;
  }
  if(!Array.isArray(data)) fail('table needs an array of objects or native PdfTable');
  if(!data.length && !options?.columns?.length) fail('empty table needs explicit columns');
  if(options?.striped===false || options?.repeatHeader===false){
    fail('custom table stripes/header repetition are not implemented yet');
  }
  const cols:TableColumn<T>[]=options?.columns??Object.keys(data[0]??{}).map(key=>({key:key as keyof T & string}));
  if(cols.length<1 || cols.length>12)fail('tables require between 1 and 12 columns');
  const fixed=cols.reduce((n,c)=>n+(typeof c.width==='number'?c.width:0),0);
  const stars=cols.filter(c=>c.width===undefined||c.width==='*').length;
  const auto=stars?(contentWidth-fixed)/stars:0;
  const columns=cols.map(c=>({header:c.title??String(c.key),width:typeof c.width==='number'?c.width:auto}));
  if(columns.some(c=>!validNumber(c.width)||c.width<36) ||
    columns.reduce((a,c)=>a+c.width,0)>contentWidth+0.02) {
    fail('table widths exceed printable page or a column is less than 36pt');
  }
  const rows=data.map(row=>cols.map(c=>{
    const val=(row as Record<string,unknown>)[c.key];
    return val===null||val===undefined?'':String(val);
  }));
  return {columns,rows};
}
type BuilderContext = {
  font?:Uint8Array;fonts:Record<string,Uint8Array>;theme?:VufraTheme;
  page:PdfPageOptions;title:string;
};
function cloneConfig(config:VufraConfig):VufraConfig{
  return {
    font:config.font ? Uint8Array.from(config.font) : undefined,
    fonts:Object.fromEntries(Object.entries(config.fonts??{}).map(([key,data])=>
      [key,data instanceof Uint8Array?Uint8Array.from(data):data])),
    theme:config.theme?structuredClone(config.theme):undefined,
  };
}
function contentWidth(ctx:BuilderContext):number {return area(ctx.page).width;}
function textBlock(ctx:BuilderContext,text:string,options?:VufraStyle):PdfBlock {
  ensureText(text);
  const style=mergeStyle(ctx.theme,undefined,options);
  if(Object.keys(style).length===0)return {type:'paragraph',text};
  const run:PdfRichRun={text,font:faceFor(style,ctx.fonts)};
  if(style.fontSize!==undefined)run.fontSize=style.fontSize;
  const color=colorHex(style.color,ctx.theme);
  if(color)run.color=color;
  return {type:'rich-paragraph',runs:[run],style:richStyle(style)};
}
function headingBlock(ctx:BuilderContext,text:string,options:HeadingOptions={}):PdfBlock {
  ensureText(text);
  const level=options.level??1;
  if(![1,2,3].includes(level))fail('heading level must be 1, 2 or 3');
  const base=ctx.theme?.[`h${level}` as 'h1'|'h2'|'h3'];
  const {level:ignore,keepWithNext, ...styleOptions}=options;
  void ignore;
  const styled=mergeStyle(ctx.theme,base,styleOptions);
  if(Object.keys(styled).length===0)
    return {type:'heading',level,text,keepWithNext:keepWithNext??true};
  const defaults=[0,21,17,14];
  const style:VufraStyle={fontSize:defaults[level],...styled};
  const result=textBlock(ctx,text,style);
  return result.type==='rich-paragraph'
    ? {...result,keepWithNext:keepWithNext??true} : result;
}
function imageBlock(data:Uint8Array,opts:ImageOptions):PdfBlock {
  if(!(data instanceof Uint8Array))fail('image needs PNG/JPEG Uint8Array bytes');
  return {type:'image',data,...opts};
}
function asRowItemText(ctx:BuilderContext,text:string,style:VufraStyle={},baseSize=11):PdfRowItem{
  ensureText(text);
  const styled=mergeStyle(ctx.theme,undefined,style);
  if(styled.font!==undefined||styled.bold||styled.color!==undefined){
    const color=colorHex(styled.color,ctx.theme);
    return {type:'rich',runs:[{text,font:faceFor(styled,ctx.fonts),
      ...(color?{color}:{}),...(styled.fontSize!==undefined?{fontSize:styled.fontSize}:{})}],
      style:richStyle(styled)};
  }
  const fontSize=styled.fontSize??baseSize;
  return {type:'text',text,style:{fontSize,lineHeight:styled.lineHeight??Math.max(fontSize*1.4,16),
    spaceBefore:styled.spaceBefore??4,spaceAfter:styled.spaceAfter??3}};
}
function buildColumnWidth(value:ColumnOptions['width'],total:number):number|null {
  if(value===undefined||value==='*')return null;
  if(typeof value==='number')return value;
  if(typeof value==='string' && /^\d+(?:\.\d+)?%$/.test(value)) {
    return total*Number.parseFloat(value)/100;
  }
  fail('column.width must be a point number, percent or "*"');
}

type DeferredColumnNode =
  | {readonly __vufraNode:VufraNode}
  | {readonly __vufraBuild:(content:ContentBuilder)=>void};
type ColumnItem=PdfRowItem|DeferredColumnNode;
function compileColumnItems(ctx:BuilderContext,width:number,items:readonly ColumnItem[]):PdfRowItem[]{
  return items.map(item=>{
    if(!('__vufraNode' in item) && !('__vufraBuild' in item))return item;
    const inner=new ContentBuilder(ctx,width,true);
    try{
      if('__vufraNode' in item)inner.add(item.__vufraNode);
      else requireSyncResult(item.__vufraBuild(inner));
    }finally{inner.close();}
    if(inner.items.length===1 && inner.items[0].type==='box'){
      return {type:'box',box:inner.items[0].box};
    }
    return {type:'box',box:{
      align:'left',padding:0,items:inner.items
    }};
  });
}
class ColumnScope {
  constructor(private readonly ctx:BuilderContext){}
  private active=true;
  readonly items:ColumnItem[]=[];
  private assertActive():void{if(!this.active)fail('column callback scope is closed');}
  close():void{this.active=false;}
  /** A column accepts text, images and flat flows; unsupported nesting fails explicitly. */
  add(children:VufraChildren):this {
    this.assertActive();
    validateNodes(children);
    for(const node of nodes(children)){
      if(!node || typeof node!=='object')fail('invalid column component');
      switch(node.kind){
        case 'paragraph': this.paragraph(node.text,node.style);break;
        case 'heading': this.heading(node.text,node.options);break;
        case 'image': this.image(node.data,node.options);break;
        case 'flow': this.add(node.children);break;
        case 'box': case 'table': case 'grid': case 'row':
          this.items.push({__vufraNode:node});break;
        default: fail('unsupported row/grid column component');
      }
    }
    return this;
  }
  /** Nested layouts are deferred until the column's actual width is calculated. */
  box(options:BoxOptions,callback:(content:ContentBuilder)=>void):this{
    this.assertActive();
    this.items.push({__vufraBuild:content=>{content.box(options,callback);}});
    return this;
  }
  table(rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions):this{
    this.assertActive();
    this.items.push({__vufraBuild:content=>{content.tableStyled(rows,options);}});
    return this;
  }
  row(options:RowOptions,callback:(row:RowScope)=>void):this;
  row(callback:(row:RowScope)=>void):this;
  row(optsOrCb:RowOptions|((row:RowScope)=>void),cb?:(row:RowScope)=>void):this{
    this.assertActive();
    this.items.push({__vufraBuild:content=>{
      if(typeof optsOrCb==='function')content.row(optsOrCb);
      else content.row(optsOrCb,cb!);
    }});
    return this;
  }
  grid(options:GridOptions,callback:(grid:GridScope)=>void):this{
    this.assertActive();
    this.items.push({__vufraBuild:content=>{content.grid(options,callback);}});
    return this;
  }
  paragraph(text:string,style?:VufraStyle):this{
    this.assertActive();this.items.push(asRowItemText(this.ctx,text,style));return this;
  }
  heading(text:string,opts:HeadingOptions={}):this{
    this.assertActive();
    const size=opts.fontSize??[0,21,17,14][opts.level??2];
    this.items.push(asRowItemText(this.ctx,text,{...opts,fontSize:size,
      lineHeight:opts.lineHeight??size*1.4,spaceBefore:opts.spaceBefore??7,spaceAfter:opts.spaceAfter??6},size));
    return this;
  }
  richText(callback:(text:{add(value:string,style?:VufraStyle):void})=>void,
    style?:Partial<PdfTextStyle>):this{
    this.assertActive();
    const runs:PdfRichRun[]=[];
    let active=true;
    const collector={add:(value:string,opts:VufraStyle={})=>{
      if(!this.active||!active)fail('column richText callback scope is closed');
      ensureText(value);
      const s=mergeStyle(this.ctx.theme,undefined,opts);
      runs.push({text:value,font:faceFor(s,this.ctx.fonts),
        ...(s.fontSize!==undefined?{fontSize:s.fontSize}:{}),
        ...(s.color?{color:colorHex(s.color,this.ctx.theme)}:{})});
    }};
    try{requireSyncResult(callback(collector));}finally{active=false;}
    if(!runs.length)fail('column richText requires runs');
    this.items.push({type:'rich',runs,style});return this;
  }
  image(data:Uint8Array,options:ImageOptions):this{
    this.assertActive();this.items.push({type:'image',data,...options});return this;
  }
  spacer(height:number):this{
    this.assertActive();this.items.push({type:'spacer',height});return this;
  }
  divider(options:DividerOptions={}):this {
    this.assertActive();this.items.push({type:'rule',width:options.width??60,
      height:options.height??2,color:options.color});return this;
  }
  rectangle(options:{width:number;height:number;color?:string}):this {
    this.assertActive();this.items.push({type:'rectangle',...options});return this;
  }
}
class RowScope {
  constructor(private readonly ctx:BuilderContext){}
  private active=true;
  close():void{this.active=false;}
  private readonly entries:Array<{options:ColumnOptions;items:ColumnItem[]}>=[] ;
  private assertActive():void{if(!this.active)fail('row callback scope is closed');}
  column(options:ColumnOptions,callback:(column:ColumnScope)=>void):this;
  column(callback:(column:ColumnScope)=>void):this;
  column(optionsOrCallback:ColumnOptions|((column:ColumnScope)=>void),
    callback?: (column:ColumnScope)=>void):this {
    this.assertActive();
    const options=typeof optionsOrCallback==='function'?{}:optionsOrCallback;
    const cb=typeof optionsOrCallback==='function'?optionsOrCallback:callback;
    if(typeof cb!=='function')fail('row.column requires a synchronous callback');
    const col=new ColumnScope(this.ctx);
    try{requireSyncResult(cb(col));}
    finally {col.close();}
    this.entries.push({options,items:col.items});
    return this;
  }
  finish(printableWidth:number,gap:number):PdfRow {
    this.active=false;
    if(this.entries.length<1||this.entries.length>6)fail('row needs between 1 and 6 columns');
    const usable=printableWidth-gap*(this.entries.length-1);
    const defined=this.entries.map(e=>buildColumnWidth(e.options.width,usable));
    const fixed=defined.reduce<number>((sum,w)=>sum+(w??0),0);
    const autoCount=defined.filter(w=>w===null).length;
    const auto=autoCount?(usable-fixed)/autoCount:0;
    const cols:PdfRowColumn[]=this.entries.map((e,i)=>({
      width:defined[i]??auto,align:e.options.align??'left',
      items:compileColumnItems(this.ctx,defined[i]??auto,e.items)
    }));
    if(cols.some(c=>!validNumber(c.width)||c.width<60) ||
      cols.reduce((a,c)=>a+c.width,0)+gap*(cols.length-1)>printableWidth+0.02){
      fail('row columns do not fit printable width (each column needs >=60pt)');
    }
    return {gap,columns:cols};
  }
}
class GridScope {
  constructor(private readonly ctx:BuilderContext){}
  private active=true;
  readonly cells:ColumnItem[][]=[];
  cell(callback:(column:ColumnScope)=>void):this {
    if(!this.active)fail('grid callback scope is closed');
    const scope=new ColumnScope(this.ctx);
    try{requireSyncResult(callback(scope));}
    finally{scope.close();}
    this.cells.push(scope.items);
    return this;
  }
  close():void{this.active=false;}
}

/** Content painted in a margin of every page, using Vufra's native row layout. */
export class PageBandScope {
  private active=true;
  private band?:PdfRow;
  constructor(private readonly ctx:BuilderContext){}
  close():void{this.active=false;}
  private add(row:PdfRow):this{
    if(!this.active)fail('page band callback scope is closed');
    if(this.band)fail('one page band supports one text, image, row or grid layout');
    this.band=row;return this;
  }
  /** Callback is invoked ONCE with string placeholders resolved natively after pagination. */
  text(value:PageBandText,style:VufraStyle={}):this{
    if(!this.active)fail('page band scope is closed');
    const text=typeof value==='function'?value({page:'{{page}}',total:'{{total}}'}):value;
    ensureText(text);
    const fontSize=style.fontSize??10;
    const item=asRowItemText(this.ctx,text,{
      fontSize,lineHeight:style.lineHeight??Math.max(15,fontSize*1.35),
      spaceBefore:0,spaceAfter:0,...style
    },10);
    return this.add({gap:0,columns:[{width:contentWidth(this.ctx),items:[item]}]});
  }
  image(data:Uint8Array,options:ImageOptions):this{
    if(!(data instanceof Uint8Array))fail('page band image requires Uint8Array');
    return this.add({gap:0,columns:[{width:contentWidth(this.ctx),items:[
      {type:'image',data,...options}
    ]}]});
  }
  row(options:RowOptions,callback:(row:RowScope)=>void):this;
  row(callback:(row:RowScope)=>void):this;
  row(optsOrCb:RowOptions|((row:RowScope)=>void),callback?:(row:RowScope)=>void):this{
    if(!this.active)fail('page band scope is closed');
    const options=typeof optsOrCb==='function'?{}:optsOrCb;
    const cb=typeof optsOrCb==='function'?optsOrCb:callback;
    if(typeof cb!=='function')fail('page band row requires a callback');
    const row=new RowScope(this.ctx);
    let result:PdfRow;
    try{requireSyncResult(cb(row));result=row.finish(contentWidth(this.ctx),options.gap??12);}
    finally{row.close();}
    return this.add(result);
  }
  grid(options:GridOptions,callback:(grid:GridScope)=>void):this{
    if(!this.active)fail('page band scope is closed');
    const n=options.columns,gap=options.gap??12;
    if(!Number.isInteger(n)||n<1||n>6||!validNumber(gap)||gap<0||gap>80)
      fail('page band grid requires 1..6 columns and gap 0..80');
    const grid=new GridScope(this.ctx);
    try{requireSyncResult(callback(grid));}finally{grid.close();}
    if(grid.cells.length!==n)fail('page band grid needs exactly one row of cells');
    const width=(contentWidth(this.ctx)-gap*(n-1))/n;
    return this.add({gap,columns:grid.cells.map(items=>({
      width,items:compileColumnItems(this.ctx,width,items)
    }))});
  }
  finish():PdfRow{
    if(!this.band)fail('page band must have visible content');
    return this.band;
  }
}

function styledTable(
  ctx:BuilderContext, innerWidth:number, rows:readonly (readonly StyledTableCell[])[],
  options:StyledTableOptions
):PdfBoxTable {
  const columns=options?.columns;
  if(!Array.isArray(columns)||columns.length<1||columns.length>6 ||
     (options.repeatHeader!==undefined&&options.repeatHeader!==true)) {
    fail('styled table requires 1..6 columns and repeatHeader true');
  }
  if(!Array.isArray(rows)||rows.length<1||rows.length>1000){
    fail('styled table requires 1..1000 rows');
  }
  const available=innerWidth;
  const assigned=columns.map(c=>buildColumnWidth(c.width,available));
  const fixed=assigned.reduce<number>((sum,w)=>sum+(w??0),0);
  const missing=assigned.filter(w=>w===null).length;
  const auto=missing?(available-fixed)/missing:0;
  const widths=assigned.map(w=>w??auto);
  if(widths.some(w=>!validNumber(w)||w<60) ||
     widths.reduce((a,b)=>a+b,0)>innerWidth+0.02){
    fail('styled table columns exceed available width or need 60pt minimum');
  }
  if(columns.some(c=>!c || typeof c.title!=='string'||!c.title.trim() ||
    (c.align!==undefined && !['left','right'].includes(c.align)))){
    fail('styled table column requires a title and valid align');
  }
  const fills:(string|undefined)[][]=[];
  const line=(cells:readonly StyledTableCell[], rowIndex:number)=>{
    if(!Array.isArray(cells)||cells.length!==columns.length) {
      fail('styled table row cells must match columns');
    }
    const backgrounds:(string|undefined)[]=[];
    const cols:PdfRow['columns']=cells.map((entry,i)=>{
      const data=typeof entry==='number'||typeof entry==='string'?{text:String(entry)}:entry;
      if(!data || !plainObject(data) || (data.align!==undefined&&!['left','right'].includes(data.align as string))){
        fail('invalid styled table cell');
      }
      const value=data as Exclude<StyledTableCell,string|number>;
      const color=value.color??(rowIndex===0?columns[i].color:undefined);
      if(value.image!==undefined && (value.text!==undefined||value.runs!==undefined)) {
        fail('styled table cell image cannot combine with text or runs');
      }
      const cell:PdfRowItem= value.image!==undefined
        ? (()=>{
          if(!(value.image instanceof Uint8Array) || !validNumber(value.width) ||
             !validNumber(value.height) || value.width<=0 || value.height<=0 ||
             value.width>widths[i] || (value.fit!==undefined&&!['contain','cover'].includes(value.fit))){
            fail('invalid styled table cell image or dimensions');
          }
          return {type:'image' as const,data:value.image,width:value.width,
            height:value.height,fit:value.fit??'contain'};
        })()
        : value.runs!==undefined
        ? (()=>{
          if(!Array.isArray(value.runs)||value.runs.length===0||value.runs.length>1000){
            fail('styled table runs must have 1..1000 spans');
          }
          const runs:PdfRichRun[]=value.runs.map(r=>{
            if(!r||typeof r.text!=='string'||!r.text.trim())fail('invalid styled table span text');
            const style:VufraStyle={font:r.font,bold:r.bold,color:r.color,fontSize:r.fontSize};
            return {text:r.text,font:faceFor(style,ctx.fonts),color:colorHex(r.color,ctx.theme),
              fontSize:r.fontSize};
          });
          return {type:'rich' as const,runs,style:{
            fontSize:11,lineHeight:18,spaceBefore:5,spaceAfter:5
          }};
        })()
        : asRowItemText(ctx,String(value.text??''),{
            bold:value.bold??(rowIndex===0&&Object.hasOwn(ctx.fonts,'bold')),
            font:value.font,
            color,fontSize:value.fontSize,
            spaceBefore:5,spaceAfter:5,lineHeight:18
          });
      backgrounds.push(colorHex(value.background??(rowIndex===0?columns[i].background:undefined),ctx.theme));
      return {width:widths[i],align:value.align??columns[i].align??'left',items:[cell]};
    });
    fills.push(backgrounds);
    return {gap:0,columns:cols};
  };
  const head=line(columns.map(c=>({text:c.title,bold:Object.hasOwn(ctx.fonts,'bold'),
    color:c.color,background:c.background,align:c.align})),0);
  const body=rows.map((r,i)=>line(r,i+1));
  return {header:head,rows:body,fills};
}

/** One visually decorated, page-fragmentable vertical flow. */
export class ContentBuilder {
  private active=true;
  readonly blocks:PdfBlock[]=[];
  readonly items:PdfBoxItem[]=[];
  constructor(private readonly ctx:BuilderContext,
    private readonly width=contentWidth(ctx), private readonly inBox=false){}
  close():void{this.active=false;}
  private pushBoxItem(item:PdfBoxItem):this {
    if(!this.active || !this.inBox) fail('box content scope is closed');
    this.items.push(item);
    return this;
  }
  private append(block:PdfBlock):this{
    if(!this.active)fail('content callback scope is closed');
    if(!this.inBox){
      this.blocks.push(block);
      return this;
    }
    switch(block.type){
      case 'paragraph':
        return this.pushBoxItem({type:'text',text:block.text,style:{
          fontSize:11,lineHeight:16,spaceBefore:5,spaceAfter:5}});
      case 'heading': {
        const size=[0,21,17,14][block.level];
        return this.pushBoxItem({type:'text',text:block.text,style:{
          fontSize:size,lineHeight:size*1.4,spaceBefore:7,spaceAfter:5}});
      }
      case 'styled-paragraph':
        return this.pushBoxItem({type:'text',text:block.text,style:block.style});
      case 'rich-paragraph':
        return this.pushBoxItem({type:'rich',runs:block.runs,style:block.style});
      case 'image':
        return this.pushBoxItem('image' in block ? {type:'image',...block.image} : block);
      case 'rule': case 'rectangle': case 'spacer':
        return this.pushBoxItem(block);
      case 'row':
        return this.pushBoxItem(block);
      case 'box':
        return this.pushBoxItem(block);
      case 'list':
        for(const [i,text] of block.items.entries()){
          this.append({type:'paragraph',text:(block.ordered?String(i+1)+'. ':'• ')+text});
        }
        return this;
      case 'table':
        return this.pushBoxItem({type:'table',table:styledTable(this.ctx,this.width,
          block.table.rows, {columns:block.table.columns.map(c=>({
            title:c.header,width:c.width
          }))})});
      default:
        fail('this component cannot be nested inside a box');
    }
  }
  /** Add a reusable functional node, or several children, without losing Fluent chaining. */
  add(children:VufraChildren):this {
    if(!this.active) fail('content callback scope is closed');
    validateNodes(children);
    for(const node of nodes(children)){
      if(!node || typeof node!=='object')fail('invalid content component');
      switch(node.kind){
        case 'paragraph': this.paragraph(node.text,node.style);break;
        case 'heading': this.heading(node.text,node.options);break;
        case 'image': this.image(node.data,node.options);break;
        case 'table': this.tableStyled(node.rows,node.options);break;
        case 'flow': this.add(node.children);break;
        case 'box': this.box(node.options,b=>b.add(node.children));break;
        case 'row': this.row(node.options,r=>{
          for(const col of node.columns){
            r.column(col.options,c=>c.add(col.children));
          }
        });break;
        case 'grid': this.grid(node.options,g=>{
          for(const cell of node.cells)g.cell(c=>c.add(cell));
        });break;
        default: fail('unsupported content node');
      }
    }
    return this;
  }
  paragraph(text:string,style?:VufraStyle):this {return this.append(textBlock(this.ctx,text,style));}
  heading(text:string,opts:HeadingOptions={}):this {return this.append(headingBlock(this.ctx,text,opts));}
  richText(callback:(text:{add(value:string,style?:VufraStyle):void})=>void,
    style?:Partial<PdfTextStyle>):this {
    const runs:PdfRichRun[]=[];
    let richActive=true;
    const rich={add:(value:string,opts:VufraStyle={})=>{
      if(!this.active||!richActive)fail('richText callback scope is closed');
      ensureText(value);
      const resolved=mergeStyle(this.ctx.theme,undefined,opts);
      const font=faceFor(resolved,this.ctx.fonts);
      const color=colorHex(resolved.color,this.ctx.theme);
      runs.push({text:value,font,
        ...(resolved.fontSize!==undefined?{fontSize:resolved.fontSize}:{}),
        ...(color?{color}:{})});
    }};
    try{requireSyncResult(callback(rich));}
    finally{richActive=false;}
    if(!runs.length)fail('richText needs at least one fragment');
    return this.append({type:'rich-paragraph',runs,style});
  }
  list(items:string[],options:{ordered?:boolean}={}):this {
    return this.append({type:'list',items,ordered:options.ordered});
  }
  image(data:Uint8Array,opts:ImageOptions):this{return this.append(imageBlock(data,opts));}
  spacer(height:number):this{return this.append({type:'spacer',height});}
  pageBreak():this{return this.append({type:'page-break'});}
  divider(options:DividerOptions={}):this{
    return this.append({type:'rule',width:options.width??this.width,
      height:options.height??2,color:colorHex(options.color,this.ctx.theme)});
  }
  rectangle(options:{width:number;height:number;color?:string}):this{
    return this.append({type:'rectangle',...options,color:colorHex(options.color,this.ctx.theme)});
  }
  box(options:BoxOptions,callback:(box:ContentBuilder)=>void):this;
  box(callback:(box:ContentBuilder)=>void):this;
  box(optionsOrCb:BoxOptions|((box:ContentBuilder)=>void),
    callback?:(box:ContentBuilder)=>void):this{
    const opts=typeof optionsOrCb==='function'?{}:optionsOrCb;
    const cb=typeof optionsOrCb==='function'?optionsOrCb:callback;
    if(typeof cb!=='function')fail('box requires a synchronous callback');
    const padding=opts.padding??12;
    const innerWidth=(opts.width??this.width)-2*padding;
    if(!Number.isFinite(innerWidth)||innerWidth<60)fail('box content width must be at least 60pt');
    const scope=new ContentBuilder(this.ctx,innerWidth,true);
    try{requireSyncResult(cb(scope));}
    finally{scope.close();}
    const boxed:PdfBox={
      ...opts,background:colorHex(opts.background,this.ctx.theme),
      border:opts.border?{...opts.border,color:colorHex(opts.border.color,this.ctx.theme)}:undefined,
      items:scope.items
    };
    return this.append({type:'box',box:boxed});
  }
  /** In a Box this is the rich table; at document root it remains the legacy table. */
  table(rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions):this;
  table<T extends object>(data:readonly T[]|PdfTable,options?:TableOptions<T>):this;
  table(data:readonly object[]|PdfTable,
    options?:StyledTableOptions|TableOptions<object>):this{
    const styled=Array.isArray(data) && data.every(Array.isArray)
      && !!options?.columns
      && options.columns.every(c=>typeof (c as StyledTableColumn).title==='string'
        && !('key' in c));
    if(styled){
      return this.tableStyled(data as readonly (readonly StyledTableCell[])[],
        options as StyledTableOptions);
    }
    if(this.inBox){
      const plain=asTable(data as readonly object[]|PdfTable,
        options as TableOptions<object>|undefined,this.width);
      return this.tableStyled(plain.rows,{columns:plain.columns.map(c=>({
        title:c.header,width:c.width
      }))});
    }
    return this.append({type:'table',table:asTable(
      data as readonly object[]|PdfTable,options as TableOptions<object>|undefined,this.width)});
  }
  tableStyled(rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions):this{
    if(this.inBox) return this.pushBoxItem({
      type:'table',table:styledTable(this.ctx,this.width,rows,options)
    });
    return this.box({padding:0},box=>box.tableStyled(rows,options));
  }
  row(options:RowOptions,callback:(row:RowScope)=>void):this;
  row(callback:(row:RowScope)=>void):this;
  row(optionsOrCb:RowOptions|((row:RowScope)=>void),callback?:(row:RowScope)=>void):this{
    const options=typeof optionsOrCb==='function'?{}:optionsOrCb;
    const cb=typeof optionsOrCb==='function'?optionsOrCb:callback;
    if(!cb)fail('row requires a callback');
    const gap=options.gap??12;
    if(!validNumber(gap)||gap<0||gap>80)fail('row.gap must be between 0 and 80pt');
    const row=new RowScope(this.ctx);
    let result:PdfRow;
    try{
      requireSyncResult(cb(row));
      result=row.finish(this.width,gap);
    } finally {row.close();}
    return this.append({type:'row',row:result});
  }
  grid(options:GridOptions,callback:(grid:GridScope)=>void):this{
    const n=options.columns,gap=options.gap??12;
    if(!Number.isInteger(n)||n<1||n>6)fail('grid.columns must be 1..6');
    if(!validNumber(gap)||gap<0||gap>80)fail('grid.gap must be 0..80');
    const grid=new GridScope(this.ctx);
    try{requireSyncResult(callback(grid));}finally{grid.close();}
    for(let i=0;i<grid.cells.length;i+=n){
      const cells=grid.cells.slice(i,i+n);
      const width=(this.width-gap*(n-1))/n;
      const cols=Array.from({length:n},(_,j)=>({
        width,items:compileColumnItems(this.ctx,width,cells[j]??[]),
        align:'left' as const
      }));
      this.append({type:'row',row:{columns:cols,gap}});
    }
    return this;
  }
  section(callback:(section:ContentBuilder)=>void):this;
  section(title:string,callback:(section:ContentBuilder)=>void):this;
  section(titleOrCallback:string|((section:ContentBuilder)=>void), callback?:(section:ContentBuilder)=>void):this{
    const title=typeof titleOrCallback==='string'?titleOrCallback:undefined;
    const cb=typeof titleOrCallback==='string'?callback:titleOrCallback;
    if(typeof cb!=='function')fail('section requires a callback');
    if(title)this.heading(title,{level:2});
    const inner=new ContentBuilder(this.ctx,this.width,this.inBox);
    try{requireSyncResult(cb(inner));}
    finally{inner.close();}
    if(this.inBox)for(const item of inner.items)this.pushBoxItem(item);
    else for(const block of inner.blocks)this.append(block);
    return this;
  }
}

export class DocumentBuilder {
  private constructor(private readonly ctx:BuilderContext,
    private readonly blocks:readonly PdfBlock[],
    private readonly chrome:PdfPageChrome={}){}
  static create(config:BuilderContext):DocumentBuilder{return new DocumentBuilder(config,[]);}
  private append(f:(scope:ContentBuilder)=>void):DocumentBuilder{
    const scope=new ContentBuilder(this.ctx);
    try{requireSyncResult(f(scope));}
    finally {scope.close();}
    return new DocumentBuilder(this.ctx,[...this.blocks,...structuredClone(scope.blocks)],
      this.chrome);
  }
  private withBand(
    name:'header'|'footer'|'firstHeader'|'firstFooter',
    callback:((scope:PageBandScope)=>void)|null
  ):DocumentBuilder {
    const chrome:PdfPageChrome=structuredClone(this.chrome);
    const hideName=({header:'hideHeader',footer:'hideFooter',
      firstHeader:'hideFirstHeader',firstFooter:'hideFirstFooter'} as const)[name];
    if(callback===null){
      delete chrome[name];
      chrome[hideName]=true;
    }else{
      if(typeof callback!=='function')fail('page band requires a callback or null');
      const scope=new PageBandScope(this.ctx);
      try{requireSyncResult(callback(scope)); chrome[name]=structuredClone(scope.finish());}
      finally{scope.close();}
      chrome[hideName]=false;
    }
    return new DocumentBuilder(this.ctx,this.blocks,chrome);
  }
  /** Define a repeating header, or pass null to hide the default header. */
  header(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('header',callback);
  }
  footer(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('footer',callback);
  }
  /** Override the first-page header; null suppresses it on the first page only. */
  firstHeader(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('firstHeader',callback);
  }
  firstFooter(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('firstFooter',callback);
  }
  /** Reuse one or many functional nodes while retaining the immutable fluent chain. */
  add(children:VufraChildren):DocumentBuilder{
    return this.append(s=>{s.add(children);});
  }
  heading(text:string,options:HeadingOptions={}):DocumentBuilder{
    return this.append(s=>{s.heading(text,options);});
  }
  paragraph(text:string,style?:VufraStyle):DocumentBuilder{
    return this.append(s=>{s.paragraph(text,style);});
  }
  richText(callback:(text:{add(value:string,style?:VufraStyle):void})=>void,
    style?:Partial<PdfTextStyle>):DocumentBuilder{
    return this.append(s=>{s.richText(callback,style);});
  }
  list(items:string[],opts?:{ordered?:boolean}):DocumentBuilder{
    return this.append(s=>{s.list(items,opts);});
  }
  image(data:Uint8Array,opts:ImageOptions):DocumentBuilder{
    return this.append(s=>{s.image(data,opts);});
  }
  spacer(height:number):DocumentBuilder{return this.append(s=>{s.spacer(height);});}
  pageBreak():DocumentBuilder{return this.append(s=>{s.pageBreak();});}
  divider(opts:DividerOptions={}):DocumentBuilder{return this.append(s=>{s.divider(opts);});}
  rectangle(opts:{width:number;height:number;color?:string}):DocumentBuilder{
    return this.append(s=>{s.rectangle(opts);});
  }
  box(options:BoxOptions,callback:(b:ContentBuilder)=>void):DocumentBuilder;
  box(callback:(b:ContentBuilder)=>void):DocumentBuilder;
  box(optionsOrCb:BoxOptions|((b:ContentBuilder)=>void),cb?:(b:ContentBuilder)=>void):DocumentBuilder {
    return this.append(s=>{if(typeof optionsOrCb==='function')s.box(optionsOrCb);
      else s.box(optionsOrCb,cb!);});
  }
  table(rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions):DocumentBuilder;
  table<T extends object>(data:readonly T[]|PdfTable,opts?:TableOptions<T>):DocumentBuilder;
  table(data:readonly object[]|PdfTable,
    opts?:TableOptions<object>|StyledTableOptions):DocumentBuilder{
    return this.append(s=>{s.table(data as readonly object[],
      opts as TableOptions<object>);});
  }
  tableStyled(rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions):DocumentBuilder{
    return this.append(s=>{s.tableStyled(rows,options);});
  }
  row(opts:RowOptions,callback:(r:RowScope)=>void):DocumentBuilder;
  row(callback:(r:RowScope)=>void):DocumentBuilder;
  row(optsOrCb:RowOptions|((r:RowScope)=>void),cb?:(r:RowScope)=>void):DocumentBuilder{
    return this.append(s=>{if(typeof optsOrCb==='function')s.row(optsOrCb);
      else s.row(optsOrCb,cb!);});
  }
  grid(opts:GridOptions,callback:(g:GridScope)=>void):DocumentBuilder{
    return this.append(s=>{s.grid(opts,callback);});
  }
  section(callback:(s:ContentBuilder)=>void):DocumentBuilder;
  section(title:string,callback:(s:ContentBuilder)=>void):DocumentBuilder;
  section(titleOrCb:string|((s:ContentBuilder)=>void),cb?:(s:ContentBuilder)=>void):DocumentBuilder{
    return this.append(s=>{if(typeof titleOrCb==='string')s.section(titleOrCb,cb!);
      else s.section(titleOrCb);});
  }
  /** Inspect the exact AST passed to the existing renderer; copy to isolate inputs. */
  toDocument():PdfDocument{
    return structuredClone({title:this.ctx.title,blocks:[...this.blocks],
      page:this.ctx.page,fontFaces:this.ctx.fonts,
      ...(Object.keys(this.chrome).length ? {pageChrome:this.chrome} : {})});
  }
  async render(options:PdfAsyncOptions={}):Promise<Uint8Array>{
    if(!this.ctx.font)fail('no font configured; use createVufra({font}) or document({font})');
    return renderPdfAsync(this.toDocument(),this.ctx.font,options);
  }
  renderSync():Uint8Array{
    if(!this.ctx.font)fail('no font configured; use createVufra({font}) or document({font})');
    return renderPdf(this.toDocument(),this.ctx.font);
  }
  enqueue(queue:PdfRenderQueue,options:PdfEnqueueOptions={}):Promise<Uint8Array>{
    if(!this.ctx.font)fail('no font configured; use createVufra({font}) or document({font})');
    return queue.render(this.toDocument(),this.ctx.font,options);
  }
}
export class Vufra {
  private readonly defaults:VufraConfig;
  constructor(defaults:VufraConfig={}) {
    this.defaults=cloneConfig(defaults);
  }
  document(options:DocumentOptions={}):DocumentBuilder{
    if(options===null || typeof options!=='object')fail('document options must be an object');
    const snapshot=cloneConfig({...this.defaults,
      fonts:{...this.defaults.fonts,...options.fonts},
      font:options.font??this.defaults.font,
      theme:options.theme??this.defaults.theme});
    const fonts=snapshot.fonts??{};
    const theme=snapshot.theme;
    const ctx:BuilderContext={
      font:snapshot.font,fonts,theme,
      title:options.title??'Documento Vufra',
      page:pageOptions(options),
    };
    return DocumentBuilder.create(ctx);
  }
  /** Return a configured instance; no module-level mutable defaults. */
  configure(config:VufraConfig):Vufra {
    return new Vufra({...this.defaults,...config,fonts:{...this.defaults.fonts,...config.fonts}});
  }
}
export function createVufra(config:VufraConfig={}):Vufra{return new Vufra(config);}
export const vufra=new Vufra();
