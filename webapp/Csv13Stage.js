/* Pure staging ledger for the observed 13-column profile. No GAS integration. */
var KakeiboCsv13Stage=(()=>{
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const fail=x=>{throw Error('CSV13_STAGE_'+x);};
 const money=x=>Number.isSafeInteger(x)&&Math.abs(x)<=999999999999;
 function apply(before,input){
  if(!input||typeof input.run_id!=='string'||!input.run_id||!['olive','amazon_master'].includes(input.card)||input.file?.profile!=='smbc-13-observed-v1'||!Array.isArray(input.file.rows)||!Array.isArray(before.transactions))fail('INPUT');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.file.billing_month)||!input.file.rows.length||input.file.rows.length>1000||JSON.stringify(input).length>400000)fail('LIMIT');
  const allowed=['row_number','used_at','merchant_raw','billing_month','payment_method_raw','column5_raw','usage_amount_reported','billed_jpy','billing_amount_status','column9_raw','foreign_amount_raw','currency_raw','exchange_rate_raw','column13_raw'];
  const numbers=new Set();for(const r of input.file.rows){if(Object.keys(r).some(k=>!allowed.includes(k))||!Number.isSafeInteger(r.row_number)||r.row_number<1||numbers.has(r.row_number))fail('ROW_SHAPE');numbers.add(r.row_number);}
  if(Object.keys(input).some(k=>!['run_id','card','expected_revision','file','resolutions','decision_context','auto_link_strict'].includes(k))||Object.keys(input.file).some(k=>!['profile','billing_month','rows','summary','persistence_ready'].includes(k)))fail('INPUT_SHAPE');
  const digest=JSON.stringify(input),s=clone(before);s.csv13_stage=s.csv13_stage||{families:[],runs:[]};const log=s.csv13_stage.runs.find(x=>x.run_id===input.run_id);
  if(log){if(log.input!==digest)fail('RUN_CHANGED');return {state:s,changed:false};}
  if(input.expected_revision!==before.revision)fail('STALE_REVISION');
  const f=input.file,key=input.card+'|'+f.billing_month;let family=s.csv13_stage.families.find(x=>x.key===key);
  if(!family){family={key,card:input.card,billing_month:f.billing_month,rows:[],snapshots:[]};s.csv13_stage.families.push(family);}
  const resolutions=input.resolutions||{},occ=new Map(),incoming=new Set();
  for(const r of f.rows){
   const d=new Date(r.used_at+'T00:00:00Z');if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==r.used_at||r.merchant_raw.length>512||Object.values(r).some(v=>typeof v==='object'&&v!==null)||Object.values(r).some(v=>typeof v==='string'&&v.length>4096))fail('ROW');
   if(!money(r.usage_amount_reported)||r.billed_jpy!==null&&!money(r.billed_jpy)||!/^\d{4}-\d{2}-\d{2}$/.test(r.used_at)||typeof r.merchant_raw!=='string')fail('ROW');
   // Mutable billing is excluded from identity; equal purchases retain multiplicity.
   const identity=JSON.stringify([r.used_at,r.merchant_raw,r.payment_method_raw,r.usage_amount_reported,r.foreign_amount_raw,r.currency_raw]);
   const ordinal=(occ.get(identity)||0)+1;occ.set(identity,ordinal);const id=identity+'#'+ordinal;incoming.add(id);
   let saved=family.rows.find(x=>x.id===id);
   if(!saved){saved={id,source:clone(r),billed_jpy:r.billed_jpy,billing_amount_status:r.billed_jpy===null?'not_listed':'listed',purchase_id:null,status:'review',history:[]};family.rows.push(saved);}
   else if(saved.billed_jpy!==r.billed_jpy){if(saved.billed_jpy!==null)fail('KNOWN_BILL_CHANGED');saved.history.push({run_id:input.run_id,previous_billed_jpy:null});saved.billed_jpy=r.billed_jpy;saved.billing_amount_status='listed';}
   const target=resolutions[String(r.row_number)];
   if(target!==undefined){if(typeof target!=='string'||!s.transactions.some(t=>t.id===target&&t.card===input.card))fail('TARGET');if(saved.purchase_id&&saved.purchase_id!==target)fail('LINK_CHANGED');if(family.rows.some(x=>x.id!==id&&x.purchase_id===target))fail('TARGET_REUSED');saved.purchase_id=target;saved.status='linked';}
  }
  // A later partial snapshot cannot delete prior rows or mark them refunded.
  family.snapshots.push({run_id:input.run_id,row_count:incoming.size});
  const known=family.rows.reduce((n,r)=>n+(r.billed_jpy===null?0:r.billed_jpy),0),missing=family.rows.filter(r=>r.billed_jpy===null).length;if(!money(known))fail('TOTAL');
  family.summary={known_billed_total:known,missing_billed_count:missing,billed_total:missing?null:known,review_count:family.rows.filter(r=>r.status==='review').length,statement_finality:'unknown'};
  s.csv13_stage.runs.push({run_id:input.run_id,input:digest});s.revision=before.revision+1;
  return {state:s,changed:true};
 }
 function plan(state,input){
  const result=apply({revision:0,transactions:state.transactions,csv13_stage:state.csv13_stage||{families:[],runs:[]}}, {...input,expected_revision:0});
  const out=clone(state);out.csv13_stage=result.state.csv13_stage;
  return {state:out,report:{replayed:!result.changed,families:out.csv13_stage.families.map(f=>({key:f.key,...f.summary}))}};
 }
 function validate(state){if(!state.csv13_stage)return;const x=state.csv13_stage;if(!Array.isArray(x.families)||!Array.isArray(x.runs)||new Set(x.families.map(f=>f.key)).size!==x.families.length||new Set(x.runs.map(r=>r.run_id)).size!==x.runs.length)fail('CORRUPT');for(const f of x.families){if(!Array.isArray(f.rows)||!Array.isArray(f.snapshots)||new Set(f.rows.map(r=>r.id)).size!==f.rows.length)fail('CORRUPT');const targets=new Set();for(const r of f.rows){if(r.billed_jpy!==null&&!money(r.billed_jpy)||!['review','linked'].includes(r.status))fail('CORRUPT');if(r.status==='linked'){if(!state.transactions.some(t=>t.id===r.purchase_id&&t.card===f.card)||targets.has(r.purchase_id))fail('CORRUPT');targets.add(r.purchase_id);}}}}
 return {apply,plan,validate};
})();
if(typeof module!=='undefined')module.exports=KakeiboCsv13Stage;
