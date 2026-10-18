/** Versioned, JSON-only templates. All layout remains in the existing native PDF engine.
 * No eval, source code, functions, filesystem/network access or implicit host locale.
 */
import {
  type VufraNode, type VufraStyle, type HeadingOptions, type BoxOptions,
  type StyledTableColumn, type StyledTableOptions,
  type DocumentOptions, type DocumentBuilder, type Vufra,
  heading, paragraph, box, table
} from './fluent';

export interface TemplateCurrencyFormat {
  kind:'currencyMinor';
  /** Currency code and locale must be explicit; no machine-dependent defaults. */
  currency:string;
  locale:string;
}
export type TemplateText = string | number | {bind:string;format?:TemplateCurrencyFormat};
export interface TemplateDataField {
  path:string;
  type:'string'|'number'|'integer'|'boolean'|'array'|'object';
  required?:boolean;
  minLength?:number;
  maxLength?:number;
}
export interface TemplateDataSchema {fields:TemplateDataField[]}

export type TemplateNode =
  | {type:'paragraph';text:TemplateText;style?:VufraStyle}
  | {type:'heading';text:TemplateText;options?:HeadingOptions}
  | {type:'box';options:BoxOptions;children:TemplateNode[]}
  | {type:'if';test:string;then:TemplateNode[];else?:TemplateNode[]}
  | {type:'each';from:string;as?:string;children:TemplateNode[]}
  | {type:'table';from:string;as?:string;columns:Array<StyledTableColumn & {value:TemplateText}>;
     options?:Omit<StyledTableOptions,'columns'>};
export interface TemplateDefinition {
  schemaVersion:1;
  title:TemplateText;
  dataSchema?:TemplateDataSchema;
  page?:DocumentOptions['page'];
  margins?:DocumentOptions['margins'];
  content:TemplateNode[];
}

function fail(msg:string):never{throw new TypeError('Vufra template: '+msg);}
function plain(v:unknown):v is Record<string,unknown>{
  return v!==null && typeof v==='object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v)===Object.prototype || Object.getPrototypeOf(v)===null);
}
function jsonSnapshot<T>(value:T,maxBytes:number):T{
  const seen=new Set<object>();
  let count=0;
  function visit(v:unknown,depth:number):void{
    if(depth>24||++count>30000)fail('JSON depth or item budget exceeded');
    if(v===null || typeof v==='string'){
      if(typeof v==='string' && v.length>64000)fail('string exceeds 64000 characters');
      return;
    }
    if(typeof v==='number' && Number.isFinite(v) || typeof v==='boolean')return;
    if(typeof v!=='object'|| (!Array.isArray(v)&&!plain(v)))fail('input must contain only JSON values');
    if(seen.has(v))fail('circular or shared references are forbidden');
    seen.add(v);
    if(Array.isArray(v)){
      if(v.length>10000)fail('array budget exceeded');
      for(const entry of v)visit(entry,depth+1);
    }else{
      for(const [k,entry] of Object.entries(v)){
        if(['__proto__','prototype','constructor'].includes(k))fail('unsafe JSON key');
        visit(entry,depth+1);
      }
    }
    seen.delete(v);
  }
  visit(value,0);
  const json=JSON.stringify(value);
  if(!json||json.length>maxBytes)fail('JSON payload exceeds byte budget');
  return JSON.parse(json) as T;
}
function allowed(v:Record<string,unknown>,keys:string[]):void{
  if(Object.keys(v).some(k=>!keys.includes(k)))fail('unknown field in template node');
}
function validPath(path:string):string[]{
  if(typeof path!=='string'||path.length>256 ||
     !/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(path))
    fail('invalid binding path');
  const keys=path.split('.');
  if(keys.some(k=>['__proto__','constructor','prototype'].includes(k)))fail('unsafe binding path');
  return keys;
}
function resolve(path:string,data:unknown,locals:Record<string,unknown>):unknown{
  const parts=validPath(path);
  let target:unknown=Object.prototype.hasOwnProperty.call(locals,parts[0])?locals:data;
  for(const part of parts){
    if(!plain(target)||!Object.prototype.hasOwnProperty.call(target,part))
      fail('binding "'+path+'" is missing');
    target=target[part];
  }
  return target;
}
function formatCurrencyMinor(value:unknown,format:TemplateCurrencyFormat):string{
  if(!Number.isSafeInteger(value) || Math.abs(value as number)>1_000_000_000_000)
    fail('currencyMinor requires a safe integer of minor currency units within 1e12');
  if(!plain(format))fail('currencyMinor format must be a JSON object');
  allowed(format,['kind','currency','locale']);
  if(format.kind!=='currencyMinor'||typeof format.currency!=='string'||
     !/^[A-Z]{3}$/.test(format.currency) || typeof format.locale!=='string' ||
     !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(format.locale))
    fail('currencyMinor needs currency ISO code and explicit locale');
  if(Intl.NumberFormat.supportedLocalesOf([format.locale]).length!==1)
    fail('currencyMinor locale is not supported by this runtime');
  const formatter=new Intl.NumberFormat(format.locale,{style:'currency',currency:format.currency,
    currencyDisplay:'code'});
  // ISO 4217 minor units vary: JPY has 0, MXN 2, KWD 3.
  const decimals=formatter.resolvedOptions().maximumFractionDigits??2;
  const divisor=10**decimals;
  return formatter.format((value as number)/divisor);
}
function asText(value:TemplateText,data:unknown,locals:Record<string,unknown>):string{
  let text:unknown=value;
  if(plain(value)){
    allowed(value,['bind','format']);
    text=resolve(value.bind as string,data,locals);
    if(value.format!==undefined)return formatCurrencyMinor(text,value.format as TemplateCurrencyFormat);
  }
  if(typeof text!=='string'&&typeof text!=='number')fail('text binding must be string or number');
  if(typeof text==='number'&&!Number.isFinite(text))fail('nonfinite text number');
  if(!String(text).trim())fail('text binding cannot be empty');
  return String(text);
}
function requireArray(path:string,data:unknown,locals:Record<string,unknown>):unknown[]{
  const value=resolve(path,data,locals);
  if(!Array.isArray(value)||value.length>1000)fail('repeat/table source must be array of <=1000');
  return value;
}
function symbol(name:string):string{
  if(name==='data'||name==='__proto__'||name==='constructor'||name==='prototype')
    fail('reserved loop variable');
  if(validPath(name).length!==1)fail('loop variable must be an identifier');
  return name;
}
function validateText(value:unknown):void{
  if(typeof value==='string')return;
  if(typeof value==='number' && Number.isFinite(value))return;
  if(!plain(value))fail('template text must be literal or bind');
  allowed(value,['bind','format']);
  validPath(value.bind as string);
  if(value.format!==undefined){
    const format=value.format;
    if(!plain(format))fail('currencyMinor format must be a JSON object');
    allowed(format,['kind','currency','locale']);
    if(format.kind!=='currencyMinor'||typeof format.currency!=='string'||
      !/^[A-Z]{3}$/.test(format.currency)||typeof format.locale!=='string'||
      !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(format.locale))
      fail('currencyMinor needs currency ISO code and explicit locale');
  }
}
function validateDataSchema(definition:TemplateDataSchema|undefined):void{
  if(definition===undefined)return;
  if(!plain(definition))fail('dataSchema must be an object');
  allowed(definition,['fields']);
  if(!Array.isArray(definition.fields)||definition.fields.length>200)
    fail('dataSchema requires at most 200 fields');
  const visited=new Set<string>();
  for(const field of definition.fields){
    if(!plain(field))fail('dataSchema field must be an object');
    allowed(field,['path','type','required','minLength','maxLength']);
    validPath(field.path);
    if(visited.has(field.path))fail('duplicate dataSchema path');
    visited.add(field.path);
    if(!['string','number','integer','boolean','array','object'].includes(field.type))
      fail('invalid dataSchema type');
    if(field.required!==undefined && typeof field.required!=='boolean')
      fail('dataSchema required must be boolean');
    if(field.minLength!==undefined||field.maxLength!==undefined){
      if(field.type!=='string'&&field.type!=='array')
        fail('dataSchema length applies only to string or array');
      if(field.minLength!==undefined&&(!Number.isInteger(field.minLength)||field.minLength<0||field.minLength>10000))
        fail('invalid dataSchema minLength');
      if(field.maxLength!==undefined&&(!Number.isInteger(field.maxLength)||field.maxLength<0||field.maxLength>10000))
        fail('invalid dataSchema maxLength');
      if((field.minLength??0)>(field.maxLength??10000))fail('dataSchema minLength exceeds maxLength');
    }
  }
}
function validateData(data:unknown,schema:TemplateDataSchema|undefined):void{
  if(!schema)return;
  for(const field of schema.fields){
    const keys=validPath(field.path);
    let target:unknown=data;
    let missing=false;
    for(const key of keys){
      if(!plain(target)||!Object.prototype.hasOwnProperty.call(target,key)){
        missing=true;break;
      }
      target=target[key];
    }
    if(missing){
      if(field.required!==false)fail('required dataSchema field "'+field.path+'" is missing');
      continue;
    }
    const valid=field.type==='array'?Array.isArray(target):
      field.type==='object'?plain(target):
      field.type==='integer'?Number.isSafeInteger(target):
      field.type==='number'?typeof target==='number'&&Number.isFinite(target):
      typeof target===field.type;
    if(!valid)fail('dataSchema field "'+field.path+'" must be '+field.type);
    if(field.minLength!==undefined||field.maxLength!==undefined){
      const length=(target as string|unknown[]).length;
      if(length<(field.minLength??0)||length>(field.maxLength??10000))
        fail('dataSchema field "'+field.path+'" length is out of bounds');
    }
  }
}
function validateShape(nodes:TemplateNode[],depth:number,budget:{remaining:number}):void{
  if(!Array.isArray(nodes)||depth>16)fail('template depth exceeded');
  for(const node of nodes){
    if(--budget.remaining<0)fail('template node budget exceeded');
    if(!plain(node)||typeof node.type!=='string')fail('invalid template node');
    switch(node.type){
      case 'paragraph':allowed(node,['type','text','style']);validateText(node.text);break;
      case 'heading':allowed(node,['type','text','options']);validateText(node.text);break;
      case 'box':
        allowed(node,['type','options','children']);
        if(!plain(node.options))fail('box requires options');
        validateShape(node.children as TemplateNode[],depth+1,budget);break;
      case 'if':
        allowed(node,['type','test','then','else']);
        validPath(node.test as string);
        validateShape(node.then as TemplateNode[],depth+1,budget);
        if(node.else!==undefined)validateShape(node.else as TemplateNode[],depth+1,budget);
        break;
      case 'each':
        allowed(node,['type','from','as','children']);
        validPath(node.from as string);symbol((node.as as string|undefined)??'item');
        validateShape(node.children as TemplateNode[],depth+1,budget);break;
      case 'table':
        allowed(node,['type','from','as','columns','options']);
        validPath(node.from as string);symbol((node.as as string|undefined)??'row');
        if(!Array.isArray(node.columns)||node.columns.length<1||node.columns.length>6)
          fail('template table requires 1..6 columns');
        for(const col of node.columns){
          if(!plain(col))fail('invalid template table column');
          allowed(col,['title','width','align','verticalAlign','padding','background','color','border','value']);
          if(typeof col.title!=='string'||!col.title.trim())fail('invalid template table column title');
          validateText(col.value);
        }
        break;
      default:fail('unsupported template node: '+String((node as Record<string,unknown>).type));
    }
  }
}
function materialize(nodes:TemplateNode[],data:unknown,locals:Record<string,unknown>,
    budget:{remaining:number},depth:number):VufraNode[]{
  if(!Array.isArray(nodes)||depth>16)fail('invalid template children/depth');
  const output:VufraNode[]=[];
  for(const node of nodes){
    if(--budget.remaining<0)fail('resolved node budget exceeded');
    if(!plain(node)||typeof node.type!=='string')fail('template node requires type');
    switch(node.type){
      case 'paragraph':
        allowed(node,['type','text','style']);
        output.push(paragraph(asText(node.text as TemplateText,data,locals),node.style as VufraStyle));
        break;
      case 'heading':
        allowed(node,['type','text','options']);
        output.push(heading(asText(node.text as TemplateText,data,locals),node.options as HeadingOptions));
        break;
      case 'box': {
        allowed(node,['type','options','children']);
        const inner=materialize(node.children as TemplateNode[],data,locals,budget,depth+1);
        if(!inner.length)fail('empty template box');
        output.push(box(node.options as BoxOptions,inner));
        break;
      }
      case 'if': {
        allowed(node,['type','test','then','else']);
        const verdict=resolve(node.test as string,data,locals);
        if(typeof verdict!=='boolean')fail('conditional binding must be boolean');
        output.push(...materialize((verdict?node.then:node.else??[]) as TemplateNode[],
          data,locals,budget,depth+1));
        break;
      }
      case 'each': {
        allowed(node,['type','from','as','children']);
        const entries=requireArray(node.from as string,data,locals);
        const alias=symbol((node.as as string|undefined)??'item');
        for(const entry of entries){
          const scope={...locals,[alias]:entry};
          output.push(...materialize(node.children as TemplateNode[],data,scope,budget,depth+1));
        }
        break;
      }
      case 'table': {
        allowed(node,['type','from','as','columns','options']);
        const entries=requireArray(node.from as string,data,locals);
        if(!entries.length)fail('table source is empty');
        const alias=symbol((node.as as string|undefined)??'row');
        const input=node.columns as Array<StyledTableColumn & {value:TemplateText}>;
        if(!Array.isArray(input)||input.length<1||input.length>6)fail('table requires 1..6 columns');
        const columns=input.map(({value,...c})=>{
          if(value===undefined)fail('table column requires value binding');
          allowed(c as Record<string,unknown>,['title','width','align','verticalAlign','padding','background','color','border']);
          return c;
        });
        const rows=entries.map(entry=>input.map(c=>asText(c.value,data,{...locals,[alias]:entry})));
        output.push(table(rows,{...(node.options as Omit<StyledTableOptions,'columns'>|undefined),columns}));
        break;
      }
      default:fail('unsupported template node: '+String((node as Record<string,unknown>).type));
    }
  }
  return output;
}

/** Freeze the contract as JSON; bind caller-provided data into ordinary Fluent nodes. */
export function defineTemplate(definition:TemplateDefinition):{
  readonly schemaVersion:1;
  document:(engine:Vufra,data:unknown)=>DocumentBuilder;
}{
  const saved=jsonSnapshot(definition,1024*1024);
  if(!plain(saved)||saved.schemaVersion!==1)fail('unsupported schemaVersion (expected 1)');
  allowed(saved,['schemaVersion','title','page','margins','content','dataSchema']);
  if(!Array.isArray(saved.content)||!saved.content.length)fail('template requires content');
  validateText(saved.title);
  validateDataSchema(saved.dataSchema);
  validateShape(saved.content,0,{remaining:10000});
  return Object.freeze({schemaVersion:1 as const,
    document(engine:Vufra,data:unknown):DocumentBuilder{
      const input=jsonSnapshot(data,4*1024*1024);
      validateData(input,saved.dataSchema);
      const title=asText(saved.title,input,Object.create(null));
      const content=materialize(saved.content,input,Object.create(null),{remaining:10000},0);
      if(!content.length)fail('template rendered no content');
      return engine.document({title,page:saved.page,margins:saved.margins}).add(content);
    }
  });
}
