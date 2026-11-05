/* Owner-commanded CSV13 purchase import; pure, revision/journal guarded by Core. */
var KakeiboCsv13Import=(()=>{
 'use strict';
 const CATS=['食費','生活用品','住まい・固定費','交通','趣味・娯楽','学業・仕事','医療','その他'];
 const FRAMES=['food','goods','home','transport','hobby','work','medical','other'];
 const clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error('CSV13_IMPORT_'+c);};
 const total=s=>s.transactions.filter(t=>!s.transactions.some(c=>c.parent_id===t.id)).reduce((n,t)=>n+(t.amount_jpy===null?0:t.amount_jpy),0);
 function plan(before,input,tools,now){
  if(!tools||typeof tools.hash!=='function'||typeof tools.merchantKey!=='function')fail('TOOLS');
  const priorRun=before.csv13_stage?.runs.find(r=>r.run_id===input.run_id);if(priorRun){if(JSON.parse(priorRun.input).decision_context!==JSON.stringify(input))fail('RUN_CHANGED');return {state:clone(before),report:{replayed:true,created:0,linked:0,valued:0,expense_delta_jpy:0,families:before.csv13_stage.families.map(f=>({key:f.key,...f.summary}))}};}
  const s=clone(before),resolutions={},decisions=clone(input.resolutions||{}),parents=new Set(s.transactions.map(t=>t.parent_id).filter(Boolean));let created=0,linked=0,valued=0;
  const normalized={...clone(input),resolutions,decision_context:JSON.stringify(input)};
  // First validate all source fields using the staging parser, with no resolutions.
  KakeiboCsv13Stage.plan({transactions:s.transactions},{...input,resolutions:{}});
  const review=KakeiboCsv13Review.preview(input.file,input.card,s),used=new Set();
  if(input.auto_link_strict===true)for(const r of review.rows)if(r.status==='unique_strict_proposal'&&decisions[String(r.row_number)]===undefined)decisions[String(r.row_number)]={kind:'link',purchase_id:r.candidate_purchase_ids[0]};
  for(const row of input.file.rows){
   const decision=decisions[String(row.row_number)];if(decision===undefined)continue;
   const d=typeof decision==='string'?{kind:'link',purchase_id:decision}:decision;
   if(!d||!['link','create'].includes(d.kind)||Object.keys(d).some(k=>!['kind','purchase_id','use_csv_jpy','evidence_ref','amount_basis','category','description','classification_evidence','match_status','detail_msg_id','candidate_msg_ids','reviewed_new'].includes(k)))fail('DECISION');
   const candidate=review.rows.find(r=>r.row_number===row.row_number);
   const valuation=()=>{if(d.amount_basis!=='verified_csv_usage_jpy'||typeof d.evidence_ref!=='string'||!d.evidence_ref.trim()||d.evidence_ref.length>500)fail('JPY_BASIS');return {status:'csv_reported',amount_jpy:row.usage_amount_reported,estimated:false,source_column:7,source_ref:d.evidence_ref,billing_finality:'not_asserted',currency_raw:row.currency_raw||null,amount_foreign_raw:row.foreign_amount_raw||null,exchange_rate_raw:row.exchange_rate_raw||null,conversion_date_raw:row.column13_raw||null};};
   let t;
   if(d.kind==='create'){
    if(d.reviewed_new!==true)fail('NEW_REQUIRES_REVIEW');
    if(!CATS.includes(d.category)||d.description!==undefined&&d.description!==null&&(typeof d.description!=='string'||d.description.length>500))fail('CLASSIFICATION');
    const v=valuation();
    const match=d.match_status||'no_candidate',mail=d.detail_msg_id||null;if(!['matched','ambiguous','no_candidate','not_needed'].includes(match)||(match==='matched')!==!!mail||mail&&(typeof mail!=='string'||s.transactions.some(t=>t.detail_msg_id===mail)))fail('MAIL_EVIDENCE');
    const key=JSON.stringify([input.card,input.file.billing_month,row.used_at,row.merchant_raw,row.usage_amount_reported,row.foreign_amount_raw||null,row.currency_raw||null]);
    const priorRows=input.file.rows.filter(r=>r.row_number<=row.row_number&&JSON.stringify([input.card,input.file.billing_month,r.used_at,r.merchant_raw,r.usage_amount_reported,r.foreign_amount_raw||null,r.currency_raw||null])===key).length;
    const id='csv13#'+tools.hash(key)+'#'+priorRows;
    if(candidate.candidate_purchase_ids.some(candidateId=>candidateId!==id))fail('NEW_REQUIRES_REVIEW');
    t=s.transactions.find(t=>t.id===id);
    if(!t){t={id,source:'csv13',card:input.card,used_at:row.used_at,merchant_raw:row.merchant_raw,merchant_key:tools.merchantKey(row.merchant_raw),amount_jpy:v.amount_jpy,amount_foreign:row.foreign_amount_raw?Number(row.foreign_amount_raw):null,currency:row.currency_raw||null,category:d.category,frame:FRAMES[CATS.indexOf(d.category)],description:d.description||null,parent_id:null,detail_msg_id:mail,match_status:match,candidate_msg_ids:Array.isArray(d.candidate_msg_ids)?d.candidate_msg_ids.slice(0,20):[],evidence:typeof d.classification_evidence==='string'?d.classification_evidence.slice(0,2000):'CSV記録に基づく購入。用途は暫定。品目は未確認。',confidence:0,classified_by:'provisional',status:'provisional',financial_status:'csv_reported',valuation:v,csv13_source_refs:[],created_at:now,updated_at:now};const rule=(s.rules||[]).find(r=>r.merchant_key===t.merchant_key&&r.needs_detail===false);if(rule){const index=rule.frame?FRAMES.indexOf(rule.frame):CATS.indexOf(rule.category);if(index>=0){t.category=CATS[index];t.frame=FRAMES[index];t.status='auto';t.classified_by='rule';t.confidence=1;}}s.transactions.push(t);created++;}
   }else{
    t=s.transactions.find(t=>t.id===d.purchase_id&&t.card===input.card);if(!t||t.parent_id||parents.has(t.id))fail('LINK_TARGET');
    if(!candidate.candidate_purchase_ids.includes(t.id))fail('LINK_NOT_CANDIDATE');
    if(d.use_csv_jpy===true){
     if(t.currency!==row.currency_raw||t.amount_foreign!==Number(row.foreign_amount_raw)||!row.foreign_amount_raw)fail('FOREIGN_IDENTITY');
     const v=valuation();if(t.amount_jpy!==null&&t.valuation?.estimated!==true&&t.amount_jpy!==v.amount_jpy)fail('KNOWN_JPY_CHANGED');
     if(t.amount_jpy!==v.amount_jpy||t.valuation?.status!=='csv_reported'){t.valuation_history=(t.valuation_history||[]).concat([{at:now,run_id:input.run_id,amount_jpy:t.amount_jpy,valuation:t.valuation||null}]);t.amount_jpy=v.amount_jpy;t.valuation=v;valued++;}
    }
    linked++;
   }
   if(used.has(t.id))fail('TARGET_REUSED');used.add(t.id);resolutions[String(row.row_number)]=t.id;
   const ref=input.card+'|'+input.file.billing_month+'|'+row.used_at+'|'+tools.hash(JSON.stringify([row.merchant_raw,row.usage_amount_reported,row.foreign_amount_raw||null,row.currency_raw||null]));
   t.csv13_source_refs=Array.from(new Set((t.csv13_source_refs||[]).concat(ref)));
  }
  const result=KakeiboCsv13Stage.plan(s,normalized);
  const delta=total(result.state)-total(before);if(!Number.isSafeInteger(delta))fail('TOTAL');
  return {state:result.state,report:{...result.report,created,linked,valued,expense_delta_jpy:delta,unknown_jpy_count:result.state.transactions.filter(t=>t.amount_jpy===null).length}};
 }
 function billingItems(state){return (state.csv13_stage?.families||[]).flatMap(f=>f.rows.map(r=>({id:'csv13-bill|'+f.key+'|'+r.id,card:f.card,billing_month:f.billing_month,billed_jpy:r.billed_jpy,kind:r.source.usage_amount_reported<0?'refund':'purchase',certainty:'unconfirmed',source_profile:'smbc-13-observed-v1',link_status:r.status})));}
 return {plan,billingItems};
})();
if(typeof module!=='undefined')module.exports=KakeiboCsv13Import;
