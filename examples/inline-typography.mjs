// Unit 13: per-run color/size, safe same-style joining, opt-in token font fallback.
// node examples/inline-typography.mjs regular.ttf bold.ttf italic.ttf serif.ttf symbols.ttf [output.pdf]
// Fonts are caller-provided and are never bundled or redistributed by Vufra.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {renderPdfAsync}=require('../packages/vufra/dist/index.js');
const [regular,bold,italic,serif,symbols,outputPath]=process.argv.slice(2);
if(!regular||!bold||!italic||!serif||!symbols)throw new Error('Pass 5 font file paths');
const blocks=[
 {type:'heading',level:1,text:'Tipografía enriquecida con estilos por fragmento'},
 {type:'rich-paragraph',style:{fontSize:12,lineHeight:18,spaceBefore:12,spaceAfter:20},
  runs:[
   {text:'El tamaño cambia: '},
   {text:'PEQUEÑO ',fontSize:8,color:'#555555'},
   {text:'GRANDE ',fontSize:30,color:'#C3372F',font:'bold'},
   {text:'y vuelve a normal. '},
   {text:'CURSIVA VERDE ',font:'italic',fontSize:16,color:'#178052'},
   {text:'serif azul.',font:'serif',fontSize:20,color:'#2056BB'}
 ]},
 {type:'heading',level:2,text:'Fallback explícito de glifos'},
 {type:'rich-paragraph',runs:[
  {text:'Fuente predeterminada: '},
  {text:'★ ',fontSize:23,color:'#C3372F',fallbackFonts:['symbols']},
  {text:'el símbolo requiere su propia fuente, incrustada en el PDF.'}
 ]},
 {type:'heading',level:2,text:'Fragmentos y continuidad entre páginas'}
];
const runs=Array.from({length:360},(_,i)=>({
 text:'INLINE'+String(i+1).padStart(4,'0')+' ',
 font:['regular','bold','italic','serif'][i%4],
 fontSize:[9,14,20,27][i%4],
 color:['#333333','#B12B2B','#12805C','#2045B0'][i%4]
}));
blocks.push({type:'rich-paragraph',runs,style:{fontSize:11,lineHeight:17,spaceBefore:10,spaceAfter:8}});
blocks.push({type:'paragraph',text:'Resultado: fuentes auténticas, tokens extraíbles y estilos visibles.'});
const pdf=await renderPdfAsync({
 title:'Vufra — Estilos y fallback seguro',
 page:{format:'letter',margins:{top:145,bottom:72,left:58,right:58}},
 fontFaces:{bold:readFileSync(bold),italic:readFileSync(italic),
  serif:readFileSync(serif),symbols:readFileSync(symbols)},
 blocks
},readFileSync(regular));
const output=outputPath||'artifacts/inline-typography.pdf';
writeFileSync(output,pdf);
console.log('Written',output,pdf.byteLength,'bytes');
