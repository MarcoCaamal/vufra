// Unit 06: styles, semantic headings, spacers and custom Letter geometry.
// node examples/styled-document.mjs /path/to/font.ttf [output.pdf]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const {renderPdf} = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('A valid installed TTF/OTF font path is required');
const output=process.argv[3] || 'artifacts/styled-document.pdf';
const pdf=renderPdf({
  title:'Vufra — Informe ejecutivo',
  page:{format:'letter', margins:{top:135,bottom:72,left:56,right:56}},
  blocks:[
    {type:'heading',level:1,text:'Informe ejecutivo de operaciones'},
    {type:'styled-paragraph',
     text:'Documento generado íntegramente desde TypeScript y Rust. Este texto utiliza una tipografía de 12 puntos, interlineado de 19 puntos y espaciado propio.',
     style:{fontSize:12,lineHeight:19,spaceBefore:12,spaceAfter:12}},
    {type:'heading',level:2,text:'Resumen de indicadores'},
    {type:'paragraph',text:'Los encabezados tienen niveles semánticos. Las tablas comparten el espacio disponible con los párrafos.'},
    {type:'table',table:{
      columns:[{header:'Indicador',width:140},{header:'Detalle',width:255},{header:'Resultado',width:105}],
      rows:Array.from({length:24},(_,i)=>[
        'Métrica '+String(i+1).padStart(2,'0'),
        i%4===0?'Resultado con descripción extensa que necesita ajuste automático y sigue siendo seleccionable.':'Indicador de prueba de documento PDF',
        (90+i*0.5).toFixed(1)+' %'
      ])
    }},
    {type:'spacer',height:22},
    {type:'heading',level:2,text:'Conclusiones'},
    {type:'styled-paragraph',
      text:'¡Hola, Cancún! Los márgenes y el tamaño Letter se aplican a todas las páginas. El contenido se distribuye automáticamente.',
      style:{fontSize:12,lineHeight:20,spaceBefore:10,spaceAfter:10}},
    {type:'heading',level:3,text:'Nota metodológica'},
    {type:'paragraph',text:'Vufra está en desarrollo experimental; no se recomienda aún para documentos de producción.'}
  ]
},readFileSync(fontPath));
writeFileSync(output,pdf);
console.log('Generated styled report:',output,pdf.byteLength,'bytes');
