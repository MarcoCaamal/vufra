// Unit 11 demonstration — lists, vector graphics and keepWithNext.
// Run: node examples/graphics-lists-usage.mjs /path/to/font.ttf [output.pdf]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require=createRequire(import.meta.url);
const {renderPdfAsync}=require('../packages/vufra/dist/index.js');
const fontPath=process.argv[2] || process.env.VUFRA_FONT;
if(!fontPath)throw new Error('Pass a TTF/OTF font path');
const output=process.argv[3] || 'artifacts/graphics-lists-report.pdf';
const photo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.jpg',import.meta.url));
const pdf=await renderPdfAsync({
  title:'Vufra — Informe de diseño documental',
  page:{format:'letter',margins:{top:135,bottom:72,left:56,right:56}},
  blocks:[
    {type:'heading',level:1,text:'Elementos gráficos y listas'},
    {type:'paragraph',text:'Una nueva unidad permite combinar bloques de texto, elementos vectoriales e imágenes manteniendo la paginación.'},
    {type:'rule',width:500,height:3,color:'#245fa8'},
    {type:'heading',level:2,text:'Capacidades del motor'},
    {type:'list',items:[
      'Listas con viñetas visibles y texto seleccionable.',
      'Listas ordenadas con numeración automática.',
      'Reglas vectoriales y rectángulos con colores RGB.',
      'La regla keepWithNext mantiene el título junto con el bloque siguiente.',
      'Compatibilidad con la API asíncrona, cancelación y cola.'
    ]},
    {type:'rectangle',width:500,height:18,color:'#dceaf7'},
    {type:'heading',level:2,text:'Flujo de trabajo'},
    {type:'list',ordered:true,items:[
      'Preparar las entradas para el documento.',
      'Medir cada elemento con la tipografía indicada.',
      'Planificar saltos de página y agrupar títulos con el siguiente bloque.',
      'Escribir el PDF con el motor Rust y verificar imágenes y texto.',
    ]},
    {type:'spacer',height:170},
    {type:'heading',level:2,text:'Fotografía demostrativa — conservada con su título'},
    {type:'image',data:photo,width:340,height:155,fit:'cover'},
    {type:'paragraph',text:'El encabezado se mueve junto con la fotografía si no caben en la página previa.'},
    {type:'heading',level:2,text:'Inventario de resultados'},
    {type:'table',table:{
      columns:[{header:'Referencia',width:130},{header:'Resultado',width:345}],
      rows:Array.from({length:42},(_,i)=>[
        'ITEM-'+String(i+1).padStart(3,'0'),
        i%3===0 ? 'Descripción más amplia para verificar la paginación correcta de varias líneas' :
          'Ejemplo de contenido válido '+(i+1)
      ])
    }},
    {type:'rule',width:500,height:2,color:'#245fa8'},
    {type:'paragraph',text:'Documento completado correctamente con títulos, gráficos, listas y tablas.'}
  ]
},readFileSync(fontPath));
writeFileSync(output,pdf);
console.log('Generated vector/list report:',output,pdf.byteLength,'bytes');
