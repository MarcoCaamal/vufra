/**
 * Vufra's primary, progressive PDF authoring API (Unit 14).
 *
 * Builders are immutable. Scoped callback builders are mutable ONLY inside the
 * callback, then sealed; both produce the same low-level AST used by the native
 * renderer. No implicit font lookup or hidden browser.
 */
import { renderPdf, renderPdfAsync, type PdfAsyncOptions, type PdfBlock,
  type PdfDocument, type PdfPageOptions, type PdfBox, type PdfBoxItem, type PdfRow, type PdfRowColumn,
  type PdfRowItem, type PdfRichRun, type PdfTable, type PdfTextStyle, type PdfPageChrome
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

class ColumnScope {
  constructor(private readonly ctx:BuilderContext){}
  private active=true;
  readonly items:PdfRowItem[]=[];
  private assertActive():void{if(!this.active)fail('column callback scope is closed');}
  close():void{this.active=false;}
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
  private readonly entries:Array<{options:ColumnOptions;items:PdfRowItem[]}>=[] ;
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
      width:defined[i]??auto,align:e.options.align??'left',items:e.items
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
  readonly cells:PdfRowItem[][]=[];
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
    return this.add({gap,columns:grid.cells.map(items=>({width,items}))});
  }
  finish():PdfRow{
    if(!this.band)fail('page band must have visible content');
    return this.band;
  }
}

/** One visually decorated, page-fragmentable vertical flow. */
class BoxScope {
  private active=true;
  readonly items:PdfBoxItem[]=[];
  constructor(private readonly ctx:BuilderContext,private readonly innerWidth:number){}
  close():void{this.active=false;}
  private add(item:PdfBoxItem):this{
    if(!this.active)fail('box callback scope is closed');
    this.items.push(item);return this;
  }
  paragraph(text:string,style:VufraStyle={}):this{
    ensureText(text);
    const styled=mergeStyle(this.ctx.theme,undefined,style);
    if(styled.bold||styled.font!==undefined){
      const color=colorHex(styled.color,this.ctx.theme);
      return this.add({type:'rich',runs:[{text,font:faceFor(styled,this.ctx.fonts),
        ...(color?{color}:{}),...(styled.fontSize!==undefined?{fontSize:styled.fontSize}:{})}],
        style:richStyle(styled)});
    }
    return this.add({type:'text',text,style:{
      fontSize:styled.fontSize??11,
      lineHeight:styled.lineHeight??Math.max(16,(styled.fontSize??11)*1.4),
      spaceBefore:styled.spaceBefore??5,spaceAfter:styled.spaceAfter??5
    },color:colorHex(styled.color,this.ctx.theme)});
  }
  heading(text:string,options:HeadingOptions={}):this{
    const level=options.level??2;
    if(![1,2,3].includes(level))fail('box heading level must be 1..3');
    const size=[0,21,17,14][level];
    const themed=this.ctx.theme?.[`h${level}` as 'h1'|'h2'|'h3'];
    return this.paragraph(text,{
      fontSize:size,lineHeight:size*1.4,spaceBefore:7,spaceAfter:5,
      ...themed,...options
    });
  }
  richText(callback:(text:{add(value:string,style?:VufraStyle):void})=>void,
    style?:Partial<PdfTextStyle>):this{
    const runs:PdfRichRun[]=[];
    let active=true;
    const collector={add:(value:string,opts:VufraStyle={})=>{
      if(!this.active||!active)fail('box richText callback scope is closed');
      ensureText(value);
      const s=mergeStyle(this.ctx.theme,undefined,opts);
      runs.push({text:value,font:faceFor(s,this.ctx.fonts),
        ...(s.fontSize!==undefined?{fontSize:s.fontSize}:{}),
        ...(s.color?{color:colorHex(s.color,this.ctx.theme)}:{})});
    }};
    try{requireSyncResult(callback(collector));}finally{active=false;}
    if(!runs.length)fail('box richText requires runs');
    return this.add({type:'rich',runs,style});
  }
  image(data:Uint8Array,options:ImageOptions):this{
    if(!(data instanceof Uint8Array))fail('box image needs PNG/JPEG bytes');
    return this.add({type:'image',data,...options});
  }
  spacer(height:number):this{return this.add({type:'spacer',height});}
  divider(options:DividerOptions={}):this{
    return this.add({type:'rule',height:options.height??1,
      width:options.width??this.innerWidth,
      color:colorHex(options.color,this.ctx.theme)});
  }
  rectangle(options:{width:number;height:number;color?:string}):this{
    return this.add({type:'rectangle',...options,
      color:colorHex(options.color,this.ctx.theme)});
  }
  list(items:string[],options:{ordered?:boolean}={}):this{
    if(!Array.isArray(items)||!items.length||items.length>1000)
      fail('box list needs 1..1000 items');
    for(const [i,text] of items.entries()){
      ensureText(text);
      this.paragraph((options.ordered?String(i+1)+'. ':'• ')+text);
    }
    return this;
  }
  row(options:RowOptions,callback:(row:RowScope)=>void):this;
  row(callback:(row:RowScope)=>void):this;
  row(optsOrCb:RowOptions|((row:RowScope)=>void),callback?:(row:RowScope)=>void):this{
    const options=typeof optsOrCb==='function'?{}:optsOrCb;
    const cb=typeof optsOrCb==='function'?optsOrCb:callback;
    if(!this.active||typeof cb!=='function')fail('box row needs synchronous callback');
    const gap=options.gap??12;
    if(!validNumber(gap)||gap<0||gap>80)fail('row.gap must be 0..80');
    const row=new RowScope(this.ctx);
    let native:PdfRow;
    try{requireSyncResult(cb(row));native=row.finish(this.innerWidth,gap);}
    finally{row.close();}
    return this.add({type:'row',row:native});
  }
  grid(options:GridOptions,callback:(grid:GridScope)=>void):this{
    const n=options.columns,gap=options.gap??12;
    if(!Number.isInteger(n)||n<1||n>6||!validNumber(gap)||gap<0||gap>80)
      fail('box grid columns must be 1..6 and gap 0..80');
    const grid=new GridScope(this.ctx);
    try{requireSyncResult(callback(grid));}finally{grid.close();}
    const width=(this.innerWidth-gap*(n-1))/n;
    if(width<60)fail('box grid cells must be at least 60pt wide');
    for(let i=0;i<grid.cells.length;i+=n){
      const cells=grid.cells.slice(i,i+n);
      this.add({type:'row',row:{gap,columns:Array.from({length:n},(_,j)=>({
        width,align:'left' as const,items:cells[j]??[]
      }))}});
    }
    return this;
  }
}
class ContentScope {
  private active=true;
  readonly blocks:PdfBlock[]=[];
  constructor(private readonly ctx:BuilderContext){}
  close():void{this.active=false;}
  private append(block:PdfBlock):this{
    if(!this.active)fail('content callback scope is closed');
    this.blocks.push(block);return this;
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
    return this.append({type:'rule',width:options.width??contentWidth(this.ctx),
      height:options.height??2,color:colorHex(options.color,this.ctx.theme)});
  }
  rectangle(options:{width:number;height:number;color?:string}):this{
    return this.append({type:'rectangle',...options,color:colorHex(options.color,this.ctx.theme)});
  }
  box(options:BoxOptions,callback:(box:BoxScope)=>void):this;
  box(callback:(box:BoxScope)=>void):this;
  box(optionsOrCb:BoxOptions|((box:BoxScope)=>void),
    callback?:(box:BoxScope)=>void):this{
    const opts=typeof optionsOrCb==='function'?{}:optionsOrCb;
    const cb=typeof optionsOrCb==='function'?optionsOrCb:callback;
    if(typeof cb!=='function')fail('box requires a synchronous callback');
    const padding=opts.padding??12;
    const innerWidth=(opts.width??contentWidth(this.ctx))-2*padding;
    if(!Number.isFinite(innerWidth)||innerWidth<60)fail('box content width must be at least 60pt');
    const scope=new BoxScope(this.ctx,innerWidth);
    try{requireSyncResult(cb(scope));}
    finally{scope.close();}
    const boxed:PdfBox={
      ...opts,background:colorHex(opts.background,this.ctx.theme),
      border:opts.border?{...opts.border,color:colorHex(opts.border.color,this.ctx.theme)}:undefined,
      items:scope.items
    };
    return this.append({type:'box',box:boxed});
  }
  table<T extends object>(data:readonly T[]|PdfTable,options?:TableOptions<T>):this {
    return this.append({type:'table',table:asTable(data,options,contentWidth(this.ctx))});
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
      result=row.finish(contentWidth(this.ctx),gap);
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
      const width=(contentWidth(this.ctx)-gap*(n-1))/n;
      const cols=Array.from({length:n},(_,j)=>({
        width,items:cells[j]??[],align:'left' as const
      }));
      this.append({type:'row',row:{columns:cols,gap}});
    }
    return this;
  }
  section(callback:(section:ContentScope)=>void):this;
  section(title:string,callback:(section:ContentScope)=>void):this;
  section(titleOrCallback:string|((section:ContentScope)=>void), callback?:(section:ContentScope)=>void):this{
    const title=typeof titleOrCallback==='string'?titleOrCallback:undefined;
    const cb=typeof titleOrCallback==='string'?callback:titleOrCallback;
    if(typeof cb!=='function')fail('section requires a callback');
    if(title)this.heading(title,{level:2});
    const inner=new ContentScope(this.ctx);
    try{requireSyncResult(cb(inner));}
    finally{inner.close();}
    for(const block of inner.blocks)this.append(block);
    return this;
  }
}

export class DocumentBuilder {
  private constructor(private readonly ctx:BuilderContext,
    private readonly blocks:readonly PdfBlock[],
    private readonly chrome:PdfPageChrome={}){}
  static create(config:BuilderContext):DocumentBuilder{return new DocumentBuilder(config,[]);}
  private append(f:(scope:ContentScope)=>void):DocumentBuilder{
    const scope=new ContentScope(this.ctx);
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
  box(options:BoxOptions,callback:(b:BoxScope)=>void):DocumentBuilder;
  box(callback:(b:BoxScope)=>void):DocumentBuilder;
  box(optionsOrCb:BoxOptions|((b:BoxScope)=>void),cb?:(b:BoxScope)=>void):DocumentBuilder {
    return this.append(s=>{if(typeof optionsOrCb==='function')s.box(optionsOrCb);
      else s.box(optionsOrCb,cb!);});
  }
  table<T extends object>(data:readonly T[]|PdfTable,opts?:TableOptions<T>):DocumentBuilder{
    return this.append(s=>{s.table(data,opts);});
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
  section(callback:(s:ContentScope)=>void):DocumentBuilder;
  section(title:string,callback:(s:ContentScope)=>void):DocumentBuilder;
  section(titleOrCb:string|((s:ContentScope)=>void),cb?:(s:ContentScope)=>void):DocumentBuilder{
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
