/** Build a heavy canonical flow for concurrency and cancellation tests. */
export function massiveFlow(title,prefix,count,extra=' renderizado nativo'){
  const chunk=10;
  return {title,blocks:Array.from({length:Math.ceil(count/chunk)},(_,i)=>({
    type:'paragraph',
    text:Array.from({length:Math.min(chunk,count-i*chunk)},(_,j)=>
      prefix+String(i*chunk+j+1).padStart(4,'0')+extra).join(' ')
  }))};
}
export function textFlow(title,text){
  return {title,blocks:[{type:'paragraph',text}]};
}
