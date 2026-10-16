// Unit 10: real PNG/JPEG images embedded alongside text and tables.
// Run: node examples/images-usage.mjs /path/to/font.ttf [output.pdf]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { renderPdfAsync } = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('Pass a valid TTF/OTF font path');
const destination = process.argv[3] || 'artifacts/images-report.pdf';
const png = readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png', import.meta.url));
const jpeg = readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.jpg', import.meta.url));
const alpha = readFileSync(new URL('../packages/vufra/tests/fixtures/transparent.png', import.meta.url));
const pdf=await renderPdfAsync({
  title:'Vufra — Informe visual',
  page:{format:'letter',margins:{top:135,bottom:72,left:56,right:56}},
  blocks:[
    {type:'heading',level:1,text:'Imágenes en el flujo documental'},
    {type:'paragraph',text:'Las imágenes se integran en el compositor sin HTML ni Chromium. PNG y JPEG conservan sus proporciones.'},
    {type:'heading',level:2,text:'PNG - contain'},
    {type:'image',data:png,width:230,height:96,fit:'contain'},
    {type:'paragraph',text:'Con contain se ve toda la imagen y el espacio sobrante del recuadro queda libre.'},
    {type:'heading',level:2,text:'JPEG - cover'},
    {type:'image',data:jpeg,width:230,height:90,fit:'cover'},
    {type:'paragraph',text:'Con cover se rellena el recuadro y se recortan los bordes fuera de él.'},
    {type:'heading',level:2,text:'PNG transparente'},
    {type:'image',data:alpha,width:100,height:100},
    {type:'table',table:{
      columns:[{header:'Folio',width:120},{header:'Descripción',width:350}],
      rows:Array.from({length:33},(_,i)=>[
        'IMG'+String(i+1).padStart(4,'0'),
        'Registro después de las imágenes '+(i+1)
      ])
    }},
    {type:'heading',level:2,text:'Conclusión'},
    {type:'paragraph',text:'La paginación se ajusta a los bloques disponibles y el texto sigue siendo seleccionable.'}
  ],
},readFileSync(fontPath));
writeFileSync(destination,pdf);
console.log('Image demo PDF generated:',destination,pdf.byteLength,'bytes');
