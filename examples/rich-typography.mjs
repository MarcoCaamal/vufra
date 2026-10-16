// Unit 12: real embedded bold, italic and alternate serif fonts within a paragraph.
// Run: node examples/rich-typography.mjs regular.ttf bold.ttf italic.ttf serif.ttf [output.pdf]
// No font files are distributed by Vufra; callers supply their own licensed fonts.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const {renderPdfAsync}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,italicPath,serifPath]=process.argv.slice(2);
if(!regularPath || !boldPath || !italicPath || !serifPath)
  throw new Error('Supply regular, bold, italic and serif font file paths');
const output=process.argv[6] || 'artifacts/rich-typography.pdf';
const font=readFileSync(regularPath);
const faceBytes={
  bold:readFileSync(boldPath),italic:readFileSync(italicPath),
  serif:readFileSync(serifPath),
};
const runs=[
  {text:'Este documento contiene '},
  {text:'negritas auténticas, ',font:'bold'},
  {text:'cursivas auténticas ',font:'italic'},
  {text:'y una familia serif diferente. ',font:'serif'},
  {text:'El contenido es seleccionable y puede paginarse.\n'},
];
for(let i=0;i<350;i++){
  runs.push({
    text:'STYLE'+String(i+1).padStart(4,'0')+' ',
    font:['regular','bold','italic','serif'][i%4]
  });
}
const pdf=await renderPdfAsync({
  title:'Vufra — Tipografía real y texto enriquecido',
  page:{format:'letter',margins:{left:60,right:60,top:140,bottom:70}},
  fontFaces:faceBytes,
  blocks:[
    {type:'heading',level:1,text:'Una fuente distinta para cada fragmento'},
    {type:'rich-paragraph',runs,style:{fontSize:13,lineHeight:21,
      spaceBefore:10,spaceAfter:12}},
    {type:'heading',level:2,text:'Resumen de compatibilidad'},
    {type:'list',items:[
      'Las fuentes adicionales son TTF/OTF proporcionadas por el consumidor.',
      'Cada fragmento tiene un identificador de fuente; regular es la predeterminada.',
      'El motor mide con Parley y dibuja con Krilla.',
      'No se simulan estilos ni se descargan fuentes automáticamente.'
    ]},
    {type:'rule',width:480,height:3,color:'#245fa8'},
    {type:'paragraph',text:'Demostración completada: 350 tokens ordenados en tipografías reales.'},
  ],
},font);
writeFileSync(output,pdf);
console.log('Created rich typography PDF:',output,pdf.byteLength,'bytes');
