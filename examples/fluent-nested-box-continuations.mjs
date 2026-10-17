// Multi-page decorated enterprise sections: three nested reusable box presets.
// Usage: node examples/fluent-nested-box-continuations.mjs REGULAR.ttf BOLD.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,output='artifacts/fluent-nested-box-continuations.pdf']=process.argv.slice(2);
if(!regular||!bold)throw Error('Provide regular and bold font files');
const engine=createVufra({
  font:readFileSync(regular),fonts:{bold:readFileSync(bold)},
  theme:{
    colors:{
      paper:'#EEF4FF',section:'#FFF2D9',ledger:'#EDF9EC',
      primary:'#173D78',borderOuter:'#BB1122',borderMid:'#AD6600',
      borderInner:'#127A3E'
    },
    presets:{
      text:{
        heading:{fontSize:15,bold:true,color:'primary'},
        chrome:{fontSize:9,color:'primary',spaceBefore:0,spaceAfter:0}
      },
      box:{
        panel:{padding:14,background:'paper',border:{width:3,color:'borderOuter'}},
        section:{padding:12,background:'section',border:{width:3,color:'borderMid'}},
        ledger:{padding:10,background:'ledger',border:{width:3,color:'borderInner'}}
      }
    }
  }
});
const rows=Array.from({length:165},(_,i)=>[
  'BILL_'+String(i+1).padStart(4,'0'),
  i%19===0 ? {runs:[
      {text:'Priority ',bold:true,color:'#173D78'},
      {text:'corporate services '+(i+1)}
    ],background:'#E1F4DC'} : 'Corporate services '+(i+1),
  {text:'MXN '+(940+i*5),align:'right'}
]);
const doc=engine.document({page:'Letter',title:'Enterprise Ledger'})
  .header(h=>h.grid({columns:['2fr','1fr']},g=>{
    g.cell(c=>c.paragraph('VUFRA_COMPANY',{preset:'chrome'}));
    g.cell(c=>c.paragraph('ENTERPRISE_LEDGER',{preset:'chrome'}));
  }))
  .footer(f=>f.text('2026 | INTERNAL',{preset:'chrome'}))
  .heading('Financial statement',{preset:'heading'})
  .paragraph('Nested panels preserve their visual bounds across pages.')
  .box({preset:'panel'},outer=>{
    outer.box({preset:'section'},middle=>
      middle.box({preset:'ledger'},inner=>inner
        .table(rows,{columns:[
          {title:'DOCUMENT',width:'26%'},
          {title:'DETAIL',width:'46%'},
          {title:'TOTAL',width:'28%',align:'right'}
        ]})
      )
    );
    outer.paragraph('CLOSING_AUDIT_MARKER',{bold:true,fontSize:12});
    outer.paragraph('The outer panel closes after the complete statement.');
  })
  .paragraph('AFTER_REPORT');
const outputPath=resolve(output);
const result=await doc.render();
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,result);
console.log(JSON.stringify({pdf:outputPath,bytes:result.length,records:rows.length}));
