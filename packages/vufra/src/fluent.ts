/**
 * Vufra's primary, progressive PDF authoring API (Unit 14).
 *
 * Builders are immutable. Scoped callback builders are mutable ONLY inside the
 * callback, then sealed; both produce the same low-level AST used by the native
 * renderer. No implicit font lookup or hidden browser.
 */
import { renderPdf, renderPdfAsync, prepareFont, prepareAssets,
  type NativeAssetResource, type NativeFontResource, type PdfAsyncOptions, type PdfBlock,
  type PdfDocument, type PdfPageOptions, type PdfBox, type PdfBoxItem, type PdfRow, type PdfRowColumn,
  type PdfRowItem, type PdfRichRun, type PdfTextStyle, type PdfPageChrome, type PdfBoxTable
} from './renderer';
import { PdfRenderQueue, type PdfEnqueueOptions } from './queue';
declare const structuredClone: <T>(value:T)=>T;

export type Color = string;
export interface VufraStyle {
  /** Named text style from theme.presets.text, local options override. */
  preset?: string;
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
  presets?: {
    text?: Record<string,Omit<VufraStyle,'preset'>>;
    box?: Record<string,Omit<BoxOptions,'preset'>>;
  };
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
/** Tokens resolved by Rust once the final page count is known; not JS per-page callbacks. */
export interface PageNumberTokens { page: string; total: string }
export type PageBandText = string | ((tokens:PageNumberTokens)=>string);
/** Padding is expressed in PDF points. Missing sides inherit from the broader scope. */
export type CellPadding = number | Partial<{top:number;right:number;bottom:number;left:number}>;
export type CellVerticalAlign = 'top' | 'center' | 'bottom';
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
  align?: 'left'|'center'|'right';
  verticalAlign?: CellVerticalAlign;
  padding?: CellPadding;
  border?: CellBorder;
  /** Merge across adjacent columns and/or subsequent rows. */
  colSpan?: number;
  /** Spanning cell content uses top alignment; its fill and frame continue across pages. */
  rowSpan?: number;
  /** Keep this group-heading row with the first following row when it fits a page. */
  keepWithNext?: boolean;
};
export interface CellBorder {width?:number;color?:string}
export interface StyledTableColumn {
  title: string;
  width?: number | '*' | `${number}%`;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: CellVerticalAlign;
  padding?: CellPadding;
  background?: string;
  color?: string;
  border?: CellBorder;
}
export interface StyledTableOptions {
  columns: StyledTableColumn[];
  padding?: CellPadding;
  verticalAlign?: CellVerticalAlign;
  border?: CellBorder;
  headerBackground?: string;
  oddRowBackground?: string;
  evenRowBackground?: string;
  /** Repeated on continuation pages. Always true in Unit18. */
  repeatHeader?: true;
}
export interface RowOptions {
  gap?:number;
  /** Spread unused width across real column gaps; requires explicit widths. */
  justify?:'start'|'space-between';
}
export interface ColumnOptions {
  width?: number | `${number}%` | '*';
  align?: 'left' | 'center' | 'right';
  verticalAlign?: CellVerticalAlign;
  padding?: CellPadding;
}
/** A grid track: fixed points, percent of usable width, or flexible fr units. */
export type GridTrack = number | '*' | `${number}%` | `${number}fr`;
/** Fit as many equal-width columns as the container can hold, up to six. */
export interface AutoGridColumns {
  /** Hard minimum width of every column in PDF points. */
  minWidth: number;
  /** Maximum number of columns, defaults to six. */
  maxColumns?: number;
}
export interface GridOptions {
  /** Fixed count, explicit tracks, or automatic minimum-width columns. */
  columns: number | readonly GridTrack[] | AutoGridColumns;
  gap?: number;
  /** Extra vertical spacing between grid rows, never after the last row. */
  rowGap?: number;
}
export interface BarChartDatum {label:string;value:number}
export interface BarChartOptions {
  /** Solid vector fill color or theme color token. */
  color?:string;
  /** Height of a PDF-native vector bar in points, 4..32. */
  barHeight?:number;
  /** Optional fixed scale, otherwise the maximum datum is used. */
  maxValue?:number;
  /** Bar rows are laid out in native horizontal columns, not raster images. */
  gap?:number;
}
export interface ImageOptions { width:number; height:number; fit?: 'contain'|'cover' }
export interface DividerOptions {height?:number;color?:string;width?:number}
/** A separate running-band composition selected at a physical page boundary. */
export type PageMasterOptions = {title?:string}&Partial<Record<
  'header'|'footer'|'oddHeader'|'evenHeader'|'oddFooter'|'evenFooter'|'firstHeader'|'firstFooter',
  ((band:PageBandScope)=>void)|null
>>;
export interface BoxOptions {
  /** Named box style from theme.presets.box, local options override. */
  preset?:string;
  width?:number;
  align?:'left'|'center'|'right';
  padding?:CellPadding;
  /** Minimum decorated height (including padding), in PDF points. */
  minHeight?:number;
  /** Maximum allowed intrinsic box height; overflow rejects, never clips. */
  maxHeight?:number;
  /** Distribute free minHeight among child block gaps, never within text lines. */
  justifyContent?:'start'|'space-between';
  /** Corner radius in PDF points (0..24, no larger than padding). */
  radius?:number;
  background?:string;
  border?:{width?:number;color?:string};
  /** Keep this container on one page; reject if it cannot fit. */
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
  | {kind:'bar-chart';data:readonly BarChartDatum[];options:BarChartOptions}
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
        case 'paragraph':case 'heading':case 'image':case 'table':case 'bar-chart':break;
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
export function barChart(data:readonly BarChartDatum[],options:BarChartOptions={}):VufraNode{
  return {kind:'bar-chart',data,options};
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
/** Presets are flat, intentionally without inheritance or recursive lookups. */
function resolveTextLayer(theme:VufraTheme|undefined,layer:VufraStyle|undefined):VufraStyle {
  if(!layer)return {};
  const {preset,...own}=layer;
  if(preset===undefined)return own;
  if(typeof preset!=='string'||!preset.trim()||
      !Object.prototype.hasOwnProperty.call(theme?.presets?.text??{},preset))
    fail('unknown text preset "'+String(preset)+'"');
  const definition=theme!.presets!.text![preset];
  if(!plainObject(definition)||Object.prototype.hasOwnProperty.call(definition,'preset'))
    fail('text presets must be flat style objects');
  return {...definition,...own};
}
function mergeStyle(theme:VufraTheme|undefined,base:VufraStyle|undefined,
  extra:VufraStyle|undefined):VufraStyle{
  return {...resolveTextLayer(theme,theme?.text),...resolveTextLayer(theme,base),
    ...resolveTextLayer(theme,extra)};
}
function resolveBoxOptions(theme:VufraTheme|undefined, options:BoxOptions):BoxOptions {
  const {preset,...own}=options;
  if(preset===undefined)return own;
  if(typeof preset!=='string'||!preset.trim()||
      !Object.prototype.hasOwnProperty.call(theme?.presets?.box??{},preset))
    fail('unknown box preset "'+String(preset)+'"');
  const definition=theme!.presets!.box![preset];
  if(!plainObject(definition)||Object.prototype.hasOwnProperty.call(definition,'preset'))
    fail('box presets must be flat style objects');
  return {...definition,...own,
    ...(own.border?{border:{...definition.border,...own.border}}:{})};
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

type BuilderContext = {
  font?:Uint8Array;nativeFont?:NativeFontResource;nativeAssets?:NativeAssetResource;
  fonts:Record<string,Uint8Array>;theme?:VufraTheme;
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
// Avoid retaining exceptionally large additional faces in two long-lived
// heaps (JS and Rust). Regular TTFs can be reused while giant faces get a
// temporary native bundle per render, still with an owned safe snapshot.
function canRetainFaces(fonts:Record<string,Uint8Array>):boolean {
  const bytes=Object.values(fonts);
  return bytes.every(font=>font.byteLength<=2*1024*1024)
    && bytes.reduce((sum,font)=>sum+font.byteLength,0)<=6*1024*1024;
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
/** Resolve grid tracks once, for body, nested boxes and page bands alike.
 * Track percentages use the space after gaps (the same rule as row columns).
 * Fractional tracks share whatever remains after fixed points and percents.
 */
function resolveGridTracks(options:GridOptions, width:number):number[] {
  const gap=options.gap??12,rowGap=options.rowGap??0;
  if(!validNumber(width)||width<=0||!validNumber(gap)||gap<0||gap>80)
    fail('grid requires positive width and gap between 0 and 80pt');
  if(!validNumber(rowGap)||rowGap<0||rowGap>80)
    fail('grid.rowGap must be between 0 and 80pt');
  const {columns}=options;
  let tracks:readonly GridTrack[];
  if(typeof columns==='number'){
    if(!Number.isInteger(columns)||columns<1||columns>6)
      fail('grid.columns must be 1..6 tracks');
    tracks=Array.from({length:columns},()=>'*' as const);
  }else if(Array.isArray(columns)){
    tracks=columns;
  }else if(plainObject(columns)){
    if(Object.keys(columns).some(key=>key!=='minWidth'&&key!=='maxColumns'))
      fail('grid auto columns only accept minWidth and maxColumns');
    const {minWidth,maxColumns=6}=columns;
    if(!validNumber(minWidth)||minWidth<60)
      fail('grid auto minWidth must be at least 60pt');
    if(!Number.isInteger(maxColumns)||!validNumber(maxColumns)||
       maxColumns<1||maxColumns>6)
      fail('grid auto maxColumns must be an integer between 1 and 6');
    if(width<minWidth)
      fail('grid auto minWidth exceeds available width');
    const count=Math.min(maxColumns,
      Math.floor((width+gap)/(minWidth+gap)));
    tracks=Array.from({length:count},()=>'*' as const);
  }else{
    fail('grid.columns requires a count, track list or auto minWidth');
  }
  if(!Array.isArray(tracks)||tracks.length<1||tracks.length>6)
    fail('grid.columns must be 1..6 tracks');
  const usable=width-gap*(tracks.length-1);
  if(!validNumber(usable)||usable<=0)
    fail('grid gaps exceed available width');
  let fixed=0,weight=0;
  const sizes=tracks.map(track=>{
    if(typeof track==='number') {
      if(!validNumber(track)||track<=0)fail('grid fixed track must be positive points');
      fixed+=track;return {fixed:track,flex:0};
    }
    if(track==='*') {weight++;return {fixed:0,flex:1};}
    if(typeof track!=='string')
      fail('grid track must be points, %, * or fr');
    const part=/^([0-9]+(?:\.[0-9]+)?)(%|fr)$/.exec(track);
    if(!part)fail('grid track must be points, %, * or fr');
    const value=Number(part[1]);
    if(!Number.isFinite(value)||value<=0)
      fail('grid track size must be finite and positive');
    if(part[2]==='fr'){weight+=value;return {fixed:0,flex:value};}
    const size=usable*value/100;
    fixed+=size;return {fixed:size,flex:0};
  });
  if(!Number.isFinite(fixed)||!Number.isFinite(weight)||fixed>usable+0.02)
    fail('grid tracks exceed available width');
  const available=Math.max(0,usable-fixed);
  const result=sizes.map(s=>s.fixed+(s.flex?available*s.flex/weight:0));
  if(result.some(n=>!validNumber(n)||n<60)||
     result.reduce((sum,n)=>sum+n,0)>usable+0.02)
    fail('grid tracks do not fit (each column needs at least 60pt)');
  return result;
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
    this.items.push({__vufraBuild:content=>{content.table(rows,options);}});
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
    const level=opts.level??2;
    const base=level===1?this.ctx.theme?.h1:level===2?this.ctx.theme?.h2:this.ctx.theme?.h3;
    const resolved=mergeStyle(this.ctx.theme,base,opts);
    const size=resolved.fontSize??[0,21,17,14][level];
    this.items.push(asRowItemText(this.ctx,text,{...resolved,fontSize:size,
      lineHeight:resolved.lineHeight??size*1.4,
      spaceBefore:resolved.spaceBefore??7,spaceAfter:resolved.spaceAfter??6},size));
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
  finish(printableWidth:number,gap:number,justify:RowOptions['justify']='start'):PdfRow {
    this.active=false;
    if(this.entries.length<1||this.entries.length>6)fail('row needs between 1 and 6 columns');
    const usable=printableWidth-gap*(this.entries.length-1);
    const defined=this.entries.map(e=>buildColumnWidth(e.options.width,usable));
    const fixed=defined.reduce<number>((sum,w)=>sum+(w??0),0);
    const autoCount=defined.filter(w=>w===null).length;
    if(!['start','space-between'].includes(justify??'start'))fail('row.justify must be start or space-between');
    if(justify==='space-between'&&(autoCount>0||this.entries.length<2))
      fail('space-between requires at least two explicitly sized columns');
    const auto=autoCount?(usable-fixed)/autoCount:0;
    const cols:PdfRowColumn[]=this.entries.map((e,i)=>{
      const width=defined[i]??auto;
      const align=e.options.align??'left';
      if(!['left','center','right'].includes(align))fail('invalid row column align');
      const enabled=e.options.padding!==undefined||e.options.verticalAlign!==undefined||align==='center';
      const padding=enabled?cellPadding({top:0,right:0,bottom:0,left:0},e.options.padding):undefined;
      if(padding && width-padding.left-padding.right<12)fail('row column padding exceeds inner width');
      return {width,align,
        ...(padding?{cell:{padding,verticalAlign:verticalAlign(e.options.verticalAlign)}}:{}),
        items:compileColumnItems(this.ctx,width-(padding?.left??0)-(padding?.right??0),e.items)
      };
    });
    if(cols.some(c=>!validNumber(c.width)||c.width<60) ||
      cols.reduce((a,c)=>a+c.width,0)+gap*(cols.length-1)>printableWidth+0.02){
      fail('row columns do not fit printable width (each column needs >=60pt)');
    }
    if(justify==='space-between'){
      const remainder=printableWidth-cols.reduce((sum,col)=>sum+col.width,0);
      const distributed=remainder/(cols.length-1);
      if(distributed>80)fail('row space-between gap exceeds native 80pt limit');
      return {gap:distributed,columns:cols};
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
    const resolved=mergeStyle(this.ctx.theme,undefined,style);
    const fontSize=resolved.fontSize??10;
    const item=asRowItemText(this.ctx,text,{
      ...resolved,fontSize,lineHeight:resolved.lineHeight??Math.max(15,fontSize*1.35),
      spaceBefore:resolved.spaceBefore??0,spaceAfter:resolved.spaceAfter??0
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
    const widths=resolveGridTracks(options,contentWidth(this.ctx));
    if((options.rowGap??0)>0)fail('page band grid has only one row; rowGap is not supported');
    const grid=new GridScope(this.ctx);
    try{requireSyncResult(callback(grid));}finally{grid.close();}
    if(grid.cells.length!==widths.length)
      fail('page band grid needs exactly one row of cells');
    return this.add({gap:options.gap??12,columns:grid.cells.map((items,i)=>({
      width:widths[i],items:compileColumnItems(this.ctx,widths[i],items)
    }))});
  }
  finish():PdfRow{
    if(!this.band)fail('page band must have visible content');
    return this.band;
  }
}

function cellPadding(base:{top:number;right:number;bottom:number;left:number},
    option:CellPadding|undefined):{top:number;right:number;bottom:number;left:number}{
  if(option===undefined)return {...base};
  const source=typeof option==='number'?{top:option,right:option,bottom:option,left:option}:option;
  if(!plainObject(source))fail('table padding requires a number or side values');
  if(Object.keys(source).some(k=>!['top','right','bottom','left'].includes(k)))
    fail('invalid table padding side');
  const result={...base,...source};
  if(Object.values(result).some(x=>!validNumber(x)||x<0||x>40))
    fail('table padding sides must be between 0 and 40pt');
  return result;
}
function verticalAlign(value:CellVerticalAlign|undefined):CellVerticalAlign{
  if(value!==undefined && !['top','center','bottom'].includes(value))
    fail('table verticalAlign must be top, center or bottom');
  return value??'top';
}
function tableBorder(ctx:BuilderContext, override:CellBorder|undefined, fallback:CellBorder|undefined):{width:number;color:string}{
  const chosen:CellBorder=override??fallback??{width:0.5,color:'#BBC5CF'};
  if(!plainObject(chosen) || Object.keys(chosen).some(k=>!['width','color'].includes(k)))
    fail('invalid table cell border');
  const width=chosen.width??0.5;
  if(!validNumber(width)||width<0||width>4)fail('table border width must be 0..4pt');
  const rawColor=chosen.color;
  if(rawColor!==undefined && typeof rawColor!=='string')fail('invalid table border color');
  return {width,color:colorHex(typeof rawColor==='string'?rawColor:'#BBC5CF',ctx.theme)!};
}
function boxPadding(value:CellPadding|undefined):{top:number;right:number;bottom:number;left:number}{
  const base={top:12,right:12,bottom:12,left:12};
  if(value===undefined)return base;
  const source=typeof value==='number'?{top:value,right:value,bottom:value,left:value}:value;
  if(!plainObject(source)||Object.keys(source).some(k=>!['top','right','bottom','left'].includes(k)))
    fail('box padding requires four valid sides');
  const resolved={...base,...source};
  if(Object.values(resolved).some(x=>!validNumber(x)||x<0||x>60))
    fail('box padding sides must be between 0 and 60pt');
  return resolved;
}
function styledTable(
  ctx:BuilderContext, innerWidth:number, rows:readonly (readonly StyledTableCell[])[],
  options:StyledTableOptions
):PdfBoxTable {
  const columns=options?.columns;
  const tablePadding=cellPadding({top:5,right:0,bottom:5,left:0},options?.padding);
  const defaultVertical=verticalAlign(options?.verticalAlign);
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
    (c.align!==undefined && !['left','center','right'].includes(c.align)))){
    fail('styled table column requires a title and valid align');
  }
  columns.forEach(c=>{cellPadding(tablePadding,c.padding);verticalAlign(c.verticalAlign);});
  const baseBorder=tableBorder(ctx,options.border,undefined);
  const alternate=[options.headerBackground,options.oddRowBackground,options.evenRowBackground]
    .map(value=>colorHex(value,ctx.theme));
  const borders:{width:number;color:string}[][]=[];
  const keepWithNext:number[]=[];
  const rowSpans:Array<{row:number;column:number;colSpan:number;rowSpan:number}>=[];
  const fills:(string|undefined)[][]=[];
  const line=(cells:readonly StyledTableCell[], rowIndex:number)=>{
    if(!Array.isArray(cells)||cells.length<1||cells.length>columns.length) {
      fail('styled table row cells must match columns or use colSpan');
    }
    let cursor=0;
    const slots=cells.map(entry=>{
      const data=typeof entry==='number'||typeof entry==='string'?{text:String(entry)}:entry;
      if(!data||!plainObject(data)||
        (data.align!==undefined&&!['left','center','right'].includes(data.align as string)))
        fail('invalid styled table cell');
      const value=data as Exclude<StyledTableCell,string|number>;
      const span=value.colSpan??1;
      if(!Number.isInteger(span)||span<1||rowIndex===0&&span!==1 || cursor+span>columns.length)
        fail('invalid colSpan: every span must cover 1..remaining columns; header cannot merge');
      const index=cursor;
      cursor+=span;
      const width=widths.slice(index,cursor).reduce((sum,x)=>sum+x,0);
      return {value,index,width};
    });
    if(cursor!==columns.length)fail('styled table row colSpan does not cover all columns');
    for(const {value,index} of slots){
      if(value.keepWithNext!==undefined){
        if(typeof value.keepWithNext!=='boolean' || (value.keepWithNext && (index!==0 || slots.length!==1 || rowIndex===0)))
          fail('keepWithNext requires a merged heading covering the whole body row');
        if(value.keepWithNext)keepWithNext.push(rowIndex-1);
      }
    }
    const backgrounds:(string|undefined)[]=[];
    const edge:{width:number;color:string}[]=[];
    const cols:PdfRow['columns']=slots.map(({value,index:i,width})=>{
      const padding=cellPadding(cellPadding(tablePadding,columns[i].padding),value.padding);
      const valign=verticalAlign(value.verticalAlign??columns[i].verticalAlign??defaultVertical);
      if(padding.left+padding.right>width-12)fail('table cell padding exceeds inner width');
      const color=value.color??(rowIndex===0?columns[i].color:undefined);
      if(value.image!==undefined && (value.text!==undefined||value.runs!==undefined)) {
        fail('styled table cell image cannot combine with text or runs');
      }
      const cell:PdfRowItem= value.image!==undefined
        ? (()=>{
          if(!(value.image instanceof Uint8Array) || !validNumber(value.width) ||
             !validNumber(value.height) || value.width<=0 || value.height<=0 ||
             value.width>width-padding.left-padding.right || (value.fit!==undefined&&!['contain','cover'].includes(value.fit))){
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
            fontSize:11,lineHeight:18,spaceBefore:0,spaceAfter:0
          }};
        })()
        : typeof value.text==='string' && !value.text.trim()
        ? {type:'spacer' as const,height:18}
        : asRowItemText(ctx,String(value.text??''),{
            bold:value.bold??(rowIndex===0&&Object.hasOwn(ctx.fonts,'bold')),
            font:value.font,
            color,fontSize:value.fontSize,
            spaceBefore:0,spaceAfter:0,lineHeight:18
          });
      backgrounds.push(colorHex(value.background??(rowIndex===0?columns[i].background:undefined),ctx.theme)
        ?? alternate[rowIndex===0?0:rowIndex%2===1?1:2]);
      edge.push(tableBorder(ctx,value.border,columns[i].border??baseBorder));
      return {width,align:value.align??columns[i].align??'left',
        cell:{padding,verticalAlign:valign},items:[cell]};
    });
    fills.push(backgrounds);
    borders.push(edge);
    return {gap:0,columns:cols};
  };
  // Resolve rectangular spans before shaping. Continuation slots are real
  // blank physical columns, while native table geometry owns their shared
  // fills/borders and knows when each span begins and ends on a PDF page.
  type SpanCover={owner:number;start:number;width:number;until:number};
  const covers:Array<SpanCover|undefined>=Array(columns.length).fill(undefined);
  const expanded=rows.map((source,row)=>{
    if(!Array.isArray(source))fail('styled table row must be an array');
    const output:StyledTableCell[]=[];
    let cellIndex=0;
    for(let col=0;col<columns.length;){
      const cover=covers[col];
      if(cover && cover.until>row){
        if(cover.start!==col)fail('corrupt table rowSpan coverage');
        const padding:CellPadding={top:0,bottom:0,left:0,right:0};
        output.push({text:'',colSpan:cover.width,padding});
        col+=cover.width;
        continue;
      }
      if(cellIndex>=source.length)fail('styled table row does not cover all columns');
      const entry=source[cellIndex++];
      const value=(typeof entry==='string'||typeof entry==='number')
        ?{text:String(entry)}:entry;
      if(!value||!plainObject(value))fail('invalid styled table cell');
      const colspan=value.colSpan as number|undefined ?? 1;
      const rowspan=value.rowSpan as number|undefined ?? 1;
      if(!Number.isInteger(colspan)||colspan<1||col+colspan>columns.length ||
         !Number.isInteger(rowspan)||rowspan<1||rowspan>32||row+rowspan>rows.length)
        fail('invalid rowSpan/colSpan: rectangle exceeds body table bounds');
      for(let track=col;track<col+colspan;track++){
        if(covers[track]&&covers[track]!.until>row)
          fail('overlapping rowSpan or colSpan rectangles');
      }
      if(rowspan>1){
        if(value.verticalAlign!==undefined && value.verticalAlign!=='top')
          fail('rowSpan cells currently require verticalAlign top');
        rowSpans.push({row,column:col,colSpan:colspan,rowSpan:rowspan});
        const next={owner:row,start:col,width:colspan,until:row+rowspan};
        for(let track=col;track<col+colspan;track++)covers[track]=next;
      }
      output.push(rowspan>1?{...value,verticalAlign:'top'}:value);
      col+=colspan;
    }
    if(cellIndex!==source.length)fail('too many cells; a rowSpan occupies these columns');
    return output;
  });
  const head=line(columns.map(c=>({text:c.title,bold:Object.hasOwn(ctx.fonts,'bold'),
    color:c.color,background:c.background,align:c.align,
    padding:c.padding,verticalAlign:c.verticalAlign,border:c.border})),0);
  const body=expanded.map((r,i)=>line(r,i+1));
  if(keepWithNext.includes(rows.length-1))
    fail('keepWithNext requires a following body row');
  return {header:head,rows:body,fills,borders,keepWithNext,rowSpans};
}

/** Flatten grouped records into a single paginated table with a merged group title.
 * Totals stay as caller-provided strings/numbers to avoid imprecise currency math.
 */
export function groupTableRows(groups:readonly {
  title:string;
  rows:readonly (readonly StyledTableCell[])[];
  subtotal?:readonly StyledTableCell[];
}[],columnCount:number,options:{groupBackground?:string;subtotalBackground?:string;bold?:boolean}={}):StyledTableCell[][]{
  if(!Number.isInteger(columnCount)||columnCount<1||columnCount>6)
    fail('groupTableRows needs 1..6 columns');
  if(!Array.isArray(groups)||groups.length<1||groups.length>200)
    fail('groupTableRows needs 1..200 groups');
  const result:StyledTableCell[][]=[];
  for(const group of groups){
    if(!group||typeof group.title!=='string'||!group.title.trim()||
      !Array.isArray(group.rows)||group.rows.length===0)
      fail('groupTableRows group requires title and rows');
    const fill=options.groupBackground;
    result.push([{
      text:group.title,colSpan:columnCount,keepWithNext:true,
      bold:options.bold??false,background:fill
    }]);
    for(const row of group.rows){
      if(!Array.isArray(row)||row.length!==columnCount)
        fail('groupTableRows row does not match column count');
      result.push([...row]);
    }
    if(group.subtotal){
      if(group.subtotal.length!==columnCount)
        fail('groupTableRows subtotal does not match column count');
      result.push(group.subtotal.map((cell:StyledTableCell)=>{
        const value=typeof cell==='string'||typeof cell==='number'?{text:String(cell)}:cell;
        if(!value||!plainObject(value))fail('groupTableRows invalid subtotal cell');
        return {...value,bold:value.bold??options.bold??false,background:value.background??options.subtotalBackground};
      }));
    }
    if(result.length>1000)fail('groupTableRows exceeds the 1000-row table limit');
  }
  return result;
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
        return this.pushBoxItem(block);
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
        case 'table': this.table(node.rows,node.options);break;
        case 'bar-chart': this.barChart(node.data,node.options);break;
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
  /** Accessible labels/values and PDF-native vector rectangles. No raster chart dependency. */
  barChart(data:readonly BarChartDatum[],options:BarChartOptions={}):this{
    const maximumRows=this.inBox?250:1000;
    if(!Array.isArray(data)||data.length<1||data.length>maximumRows)
      fail('barChart requires 1..'+maximumRows+' records for this container');
    const barHeight=options.barHeight??12;
    const gap=options.gap??8;
    if(!validNumber(barHeight)||barHeight<4||barHeight>32||
      !validNumber(gap)||gap<0||gap>32)fail('invalid chart bar height or gap');
    const items=data.map(row=>{
      if(!row || typeof row.label!=='string'||!row.label.trim()||
        !validNumber(row.value)||row.value<0)fail('barChart needs label and nonnegative finite value');
      return {label:row.label,value:row.value};
    });
    const maximum=options.maxValue??Math.max(...items.map(d=>d.value));
    if(!validNumber(maximum)||maximum<=0 || items.some(d=>d.value>maximum))
      fail('barChart requires positive maximum at least as large as every value');
    const fill=colorHex(options.color??'#2E5AAC',this.ctx.theme);
    const labelWidth=Math.max(90,Math.min(170,this.width*0.30));
    const valueWidth=80;
    const usable=this.width-labelWidth-valueWidth-24;
    if(usable<60)fail('barChart requires at least 254pt of available width');
    for(const [i,datum] of items.entries()){
      const barWidth=datum.value===0?0:Math.max(1,usable*datum.value/maximum);
      this.row({gap:12},row=>{
        row.column({width:labelWidth},c=>c.paragraph(datum.label));
        row.column({width:usable},c=>{
          if(barWidth>0)c.rectangle({width:barWidth,height:barHeight,color:fill});
          else c.spacer(1);
        });
        row.column({width:valueWidth,align:'right'},c=>c.paragraph(String(datum.value)));
      });
      if(i+1<items.length&&gap>0)this.spacer(gap);
    }
    return this;
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
    const provided=typeof optionsOrCb==='function'?{}:optionsOrCb;
    const cb=typeof optionsOrCb==='function'?optionsOrCb:callback;
    if(typeof cb!=='function')fail('box requires a synchronous callback');
    const opts=resolveBoxOptions(this.ctx.theme,provided);
    const padding=boxPadding(opts.padding);
    if(opts.minHeight!==undefined && (!validNumber(opts.minHeight)||opts.minHeight<0))
      fail('box minHeight must be finite and nonnegative');
    if(opts.maxHeight!==undefined && (!validNumber(opts.maxHeight)||opts.maxHeight<=0||
      opts.maxHeight>20000 || (opts.minHeight!==undefined&&opts.minHeight>opts.maxHeight)))
      fail('box maxHeight must be 0..20000pt and at least minHeight');
    if(opts.justifyContent!==undefined && !['start','space-between'].includes(opts.justifyContent))
      fail('box justifyContent must be start or space-between');
    if(opts.justifyContent==='space-between' &&
      (opts.minHeight===undefined))fail('box space-between requires minHeight');
    const innerWidth=(opts.width??this.width)-padding.left-padding.right;
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
  table(rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions):this{
    if(this.inBox) return this.pushBoxItem({
      type:'table',table:styledTable(this.ctx,this.width,rows,options)
    });
    return this.box({padding:0},content=>content.table(rows,options));
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
      result=row.finish(this.width,gap,options.justify);
    } finally {row.close();}
    return this.append({type:'row',row:result});
  }
  grid(options:GridOptions,callback:(grid:GridScope)=>void):this{
    const widths=resolveGridTracks(options,this.width);
    const n=widths.length,gap=options.gap??12,rowGap=options.rowGap??0;
    const grid=new GridScope(this.ctx);
    try{requireSyncResult(callback(grid));}finally{grid.close();}
    if(grid.cells.length===0)fail('grid needs at least one cell');
    for(let i=0;i<grid.cells.length;i+=n){
      if(i>0&&rowGap>0)this.append({type:'spacer',height:rowGap});
      const cells=grid.cells.slice(i,i+n);
      const cols=widths.map((width,j)=>({
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
    private readonly chrome:PdfPageChrome={},
    private readonly pendingCoverBreak=false,
    private readonly masters:readonly {startBlock:number;pageChrome:PdfPageChrome;title?:string}[]=[]){}
  static create(config:BuilderContext):DocumentBuilder{return new DocumentBuilder(config,[]);}
  private append(f:(scope:ContentBuilder)=>void):DocumentBuilder{
    const scope=new ContentBuilder(this.ctx);
    try{requireSyncResult(f(scope));}
    finally {scope.close();}
    if(!scope.blocks.length)return this;
    const previous=this.pendingCoverBreak
      ? [...this.blocks,{type:'page-break' as const}]:this.blocks;
    return new DocumentBuilder(this.ctx,[...previous,...structuredClone(scope.blocks)],
      this.chrome,false,this.masters);
  }
  private withBand(
    name:'header'|'footer'|'firstHeader'|'firstFooter'|'oddHeader'|'evenHeader'|'oddFooter'|'evenFooter',
    callback:((scope:PageBandScope)=>void)|null
  ):DocumentBuilder {
    const chrome:PdfPageChrome=structuredClone(this.chrome);
    const hideName=({header:'hideHeader',footer:'hideFooter',
      firstHeader:'hideFirstHeader',firstFooter:'hideFirstFooter',
      oddHeader:'hideOddHeader',evenHeader:'hideEvenHeader',
      oddFooter:'hideOddFooter',evenFooter:'hideEvenFooter'} as const)[name];
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
    return new DocumentBuilder(this.ctx,this.blocks,chrome,this.pendingCoverBreak,this.masters);
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
  /** Odd/even means printed page 1, 2, 3…; firstHeader/firstFooter take precedence. */
  oddHeader(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('oddHeader',callback);
  }
  evenHeader(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('evenHeader',callback);
  }
  oddFooter(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('oddFooter',callback);
  }
  evenFooter(callback:((scope:PageBandScope)=>void)|null):DocumentBuilder{
    return this.withBand('evenFooter',callback);
  }
  /** Dedicated first-page content: no running header/footer, then one lazy page break.
   * Does not change the page size or paint full-bleed backgrounds.
   */
  coverPage(options:BoxOptions,callback:(b:ContentBuilder)=>void):DocumentBuilder{
    if(this.blocks.length||this.pendingCoverBreak)fail('coverPage must be the first document content');
    if(typeof callback!=='function')fail('coverPage requires a synchronous content callback');
    const framed=this.box({...options,keepTogether:true},callback)
      .firstHeader(null).firstFooter(null);
    return new DocumentBuilder(this.ctx,framed.blocks,framed.chrome,true,this.masters);
  }
  /** Begin a physical page section with its own header/footer master.
   * firstHeader/firstFooter here apply only to the first physical page
   * of this chapter; parity and page-number tokens remain document-wide.
   */
  pageSection(options:PageMasterOptions,callback:(content:ContentBuilder)=>void):DocumentBuilder{
    if(!options||!plainObject(options)||typeof callback!=='function')
      fail('pageSection requires band options and synchronous content callback');
    const keys=['header','footer','oddHeader','evenHeader','oddFooter','evenFooter',
      'firstHeader','firstFooter'] as const;
    if(Object.keys(options).some(k=>k!=='title'&&!keys.includes(k as typeof keys[number])))
      fail('pageSection only supports header/footer and odd/even bands');
    if(options.title!==undefined &&
      (typeof options.title!=='string'||!options.title.trim()||options.title.length>64||options.title.includes('\0')))
      fail('pageSection title must be nonempty and at most 64 characters');
    const nextChrome:PdfPageChrome=structuredClone(this.chrome);
    // Continue the last section's master unless this is the first section.
    if(this.masters.length)Object.assign(nextChrome,structuredClone(this.masters.at(-1)!.pageChrome));
    // First-page bands do not silently leak into the next chapter.
    // Section overrides are separate from document-first global chrome.
    if(this.blocks.length>0||this.masters.length>0){
      delete nextChrome.firstHeader;delete nextChrome.firstFooter;
      delete nextChrome.hideFirstHeader;delete nextChrome.hideFirstFooter;
    }
    for(const name of keys){
      const cb=options[name];
      if(cb===undefined)continue;
      const hideName=({header:'hideHeader',footer:'hideFooter',
        oddHeader:'hideOddHeader',evenHeader:'hideEvenHeader',
        oddFooter:'hideOddFooter',evenFooter:'hideEvenFooter',
        firstHeader:'hideFirstHeader',firstFooter:'hideFirstFooter'} as const)[name];
      if(cb===null){delete nextChrome[name];nextChrome[hideName]=true;continue;}
      if(typeof cb!=='function')fail('pageSection bands require a callback or null');
      const band=new PageBandScope(this.ctx);
      try{requireSyncResult(cb(band));nextChrome[name]=structuredClone(band.finish());}
      finally{band.close();}
      nextChrome[hideName]=false;
    }
    const scope=new ContentBuilder(this.ctx);
    try{requireSyncResult(callback(scope));}finally{scope.close();}
    if(!scope.blocks.length)fail('pageSection must have content');
    const breakBefore=(this.blocks.length>0||this.pendingCoverBreak) &&
      this.blocks.at(-1)?.type!=='page-break';
    const blocks=[...this.blocks,...(breakBefore?[{type:'page-break' as const}]:[]),
      ...structuredClone(scope.blocks)];
    const startBlock=this.blocks.length+(breakBefore?1:0);
    return new DocumentBuilder(this.ctx,blocks,this.chrome,false,
      [...this.masters,{startBlock,pageChrome:nextChrome,title:options.title}]);
  }
  /** Automatic paginated chapter index. Place it before named page sections.
   * Exact page numbers are resolved from the Rust paginator, not predicted.
   */
  tableOfContents(title='Contents'):DocumentBuilder {
    ensureText(title);
    if(title.length>80)fail('tableOfContents heading is too long');
    if(this.blocks.some(block=>block.type==='toc'))fail('only one table of contents is supported');
    const doc=this.heading(title);
    return new DocumentBuilder(this.ctx,
      [...doc.blocks,{type:'toc'}],doc.chrome,false,doc.masters);
  }
  /** Named chapter page reference. Resolved from the real page plan in Rust. */
  pageReference(sectionTitle:string,label=sectionTitle):DocumentBuilder {
    ensureText(sectionTitle);ensureText(label);
    if(sectionTitle.length>64||label.length>64)
      fail('pageReference labels must be at most 64 characters');
    const previous=this.pendingCoverBreak
      ?[...this.blocks,{type:'page-break' as const}]:this.blocks;
    return new DocumentBuilder(this.ctx,
      [...previous,{type:'section-reference',sectionTitle,text:label}],
      this.chrome,false,this.masters);
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
  barChart(data:readonly BarChartDatum[],options:BarChartOptions={}):DocumentBuilder{
    return this.append(s=>{s.barChart(data,options);});
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
  table(rows:readonly (readonly StyledTableCell[])[],options:StyledTableOptions):DocumentBuilder{
    return this.append(s=>{s.table(rows,options);});
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
  /** Internal immutable builder tree; the native bridge consumes it immediately.
   * Never expose this reference to callers: toDocument returns an isolated copy.
   */
  private renderInput():PdfDocument {
    // Expand the authoring-only TOC before normalization. Both the section
    // boundaries and their references are remapped to the final block indices.
    const named=this.masters.map((master,index)=>({master,index}))
      .filter(({master})=>master.title!==undefined);
    const blocks:PdfBlock[]=[];
    const starts:number[]=[];
    let tocRefs=0;
    for(const [index,block] of this.blocks.entries()){
      starts[index]=blocks.length;
      if(block.type==='toc'){
        if(named.length===0)fail('tableOfContents requires named pageSections');
        for(const {master,index:section} of named){
          blocks.push({type:'page-reference',text:master.title!,targetBlock:section});
          tocRefs++;
        }
      }else if(block.type==='section-reference'){
        const matching=named.filter(({master})=>master.title===block.sectionTitle);
        if(matching.length!==1)fail('pageReference needs exactly one named pageSection: '+block.sectionTitle);
        blocks.push({type:'page-reference',text:block.text,targetBlock:matching[0].index});
        tocRefs++;
      }else blocks.push(block);
    }
    if(tocRefs){
      for(const block of blocks){
        if(block.type==='page-reference'){
          const master=this.masters[block.targetBlock];
          block.targetBlock=starts[master.startBlock];
        }
      }
    }
    return {title:this.ctx.title,blocks,page:this.ctx.page,fontFaces:this.ctx.fonts,
      ...(Object.keys(this.chrome).length?{pageChrome:this.chrome}:{}),
      ...(this.masters.length?{pageMasters:this.masters.map(m=>({
        startBlock:starts[m.startBlock],pageChrome:structuredClone(m.pageChrome),title:m.title
      }))}:{})};
  }
  /** Deep snapshot for inspection or mutation without changing the builder. */
  toDocument():PdfDocument {
    return structuredClone(this.renderInput());
  }
  async render(options:PdfAsyncOptions={}):Promise<Uint8Array>{
    if(!this.ctx.font)fail('no font configured; use createVufra({font}) or document({font})');
    return renderPdfAsync(this.renderInput(),this.ctx.nativeFont??this.ctx.font,options,this.ctx.nativeAssets);
  }
  renderSync():Uint8Array{
    if(!this.ctx.font)fail('no font configured; use createVufra({font}) or document({font})');
    return renderPdf(this.renderInput(),this.ctx.nativeFont??this.ctx.font,this.ctx.nativeAssets);
  }
  enqueue(queue:PdfRenderQueue,options:PdfEnqueueOptions={}):Promise<Uint8Array>{
    if(!this.ctx.font)fail('no font configured; use createVufra({font}) or document({font})');
    return queue.render(this.renderInput(),this.ctx.font,options);
  }
}
export class Vufra {
  private readonly defaults:VufraConfig;
  private readonly defaultFontResource?:NativeFontResource;
  private readonly defaultAssets?:NativeAssetResource;
  constructor(defaults:VufraConfig={}) {
    this.defaults=cloneConfig(defaults);
    // One isolated native-owned snapshot per Vufra instance, reused by all
    // documents built with the default font. No mutable caller buffer retained.
    this.defaultFontResource=this.defaults.font?prepareFont(this.defaults.font):undefined;
    this.defaultAssets=canRetainFaces(this.defaults.fonts??{})
      ?prepareAssets(this.defaults.fonts??{}):undefined;
  }
  document(options:DocumentOptions={}):DocumentBuilder{
    if(options===null || typeof options!=='object')fail('document options must be an object');
    // Clone only caller-provided overrides; defaults are already private
    // snapshots and cannot be reached through toDocument() or fluent builders.
    const override=cloneConfig({font:options.font,fonts:options.fonts,theme:options.theme});
    const fonts={...(this.defaults.fonts??{}),...(override.fonts??{})};
    const font=override.font??this.defaults.font;
    const nativeFont=override.font?prepareFont(override.font):this.defaultFontResource;
    const nativeAssets=canRetainFaces(fonts)
      ?(Object.keys(override.fonts??{}).length
        ?prepareAssets(fonts):this.defaultAssets)
      :undefined;
    const ctx:BuilderContext={
      font,nativeFont,nativeAssets,fonts,theme:override.theme??this.defaults.theme,
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
