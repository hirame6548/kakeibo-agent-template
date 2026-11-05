/* Offline readback verification. No network, writes or authority. */
'use strict';
const crypto=require('node:crypto'),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const CAPABILITY='purchase-details-v5-fullrow-verified-readback';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const stableHash=x=>hash(canonical(x)),clone=x=>JSON.parse(JSON.stringify(x));
const FIN=['id','source','card','used_at','merchant_raw','merchant_key','amount_jpy','amount_foreign','currency','parent_id','csv_bill_ids','csv_status','csv_origin','csv13_source_refs','valuation','valuation_history'];
const CLASS_FIELDS=['match_status','candidate_msg_ids','confidence','updated_at','classification_result','classification_prior','detail_msg_id','detail_mailbox','description','evidence','category','frame','frame_by','classified_by','status','classification_suggestion'];
const pick=(t,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(t,k)).map(k=>[k,t[k]]));
const finances=s=>stableHash({transactions:s.transactions.map(t=>pick(t,FIN)).sort((a,b)=>a.id.localeCompare(b.id)),csv:s.csv,csv13_stage:s.csv13_stage,assets:s.assets});
const protectedOwner=(s,t)=>t.classified_by==='user'||t.status==='confirmed'||t.user_locked||t.user_category_lock||!!s.history?.[t.id];
function normalized(t,spec){const row=clone(t);if(spec.classification_clock)row.updated_at='__GAS_COMMIT_TIME__';if(spec.new_details_run)row.purchase_details=(row.purchase_details||[]).map((d,i)=>i>=spec.prior_details_count&&d.run_id===spec.new_details_run?{...d,at:'__GAS_COMMIT_TIME__'}:d);return row;}
function expectations(before,after,exchange,report){
 const classifications=new Set((report.classification?.outcomes||[]).filter(o=>['auto','review','provisional'].includes(o.outcome)).map(o=>o.id));
 const registered=new Set((report.mail?.outcomes||[]).filter(o=>o.status==='registered').map(o=>o.purchase_id));
 const allowedChildren=new Set((exchange.classification_file?.results||[]).filter(r=>classifications.has(r.id)&&report.classification?.outcomes?.some(o=>o.id===r.id&&o.outcome==='auto')).flatMap(r=>(r.items||[]).map((_,i)=>r.id+'#item'+(i+1))));
 const rows=after.transactions.map(t=>{
  const original=before.transactions.find(o=>o.id===t.id),locked=original&&protectedOwner(before,original);
  const isChild=!original&&t.parent_id&&allowedChildren.has(t.id)&&t.id.startsWith(t.parent_id+'#item');
  if(!original&&!registered.has(t.id)&&!isChild)throw Error('CONFIRM_UNPLANNED_NEW_ID');
  const classTarget=classifications.has(t.id)||isChild;
  if(original&&classTarget&&(!global.KakeiboClassification?.eligible(before,original,true)||locked))throw Error('CONFIRM_INELIGIBLE_CLASSIFICATION_CHANGE');
  const count=original?.purchase_details?.length||0;
  const appended=(t.purchase_details||[]).length>count;
  const newDetails=appended&&exchange.details_file&&(t.purchase_details||[]).slice(count).every(d=>d.run_id===exchange.details_file.run_id);
  const allowed=new Set([...(classTarget?CLASS_FIELDS:[]),...(newDetails?['purchase_details']:[])]);
  if(original){for(const k of new Set([...Object.keys(original),...Object.keys(t)]))if((Object.hasOwn(original,k)!==Object.hasOwn(t,k)||stableHash([original[k]])!==stableHash([t[k]]))&&!allowed.has(k))throw Error('CONFIRM_UNPLANNED_FIELD_CHANGE:'+t.id+':'+k);if(locked&&stableHash(original)!==stableHash(t))throw Error('CONFIRM_PROTECTED_ROW_CHANGE');}
  const spec={id:t.id,protected:!!locked,classification_clock:!locked&&classTarget,new_details_run:!locked&&newDetails?exchange.details_file.run_id:null,prior_details_count:count,allowed_change_fields:[...allowed]};
  return {...spec,hash:stableHash(locked?original:normalized(t,spec))};
 });
 if(before.transactions.some(t=>!after.transactions.some(u=>u.id===t.id)))throw Error('CONFIRM_REMOVED_EXISTING_ID');
 return {schema_version:2,outer_run_id:exchange.run_id,exchange_digest:'u8v1:'+hash(exchange),generated_at:exchange.generated_at,details_run_id:exchange.details_file?.run_id||null,details_digest:exchange.details_file?hash(exchange.details_file):null,financial_hash:finances(after),rules_hash:stableHash(before.rules),history_hash:stableHash(before.history),rows,details:(exchange.details_file?.results||[]).map(result=>{const entry=after.transactions.find(t=>t.id===result.id)?.purchase_details?.find(d=>d.run_id===exchange.details_file.run_id),o=report.details?.outcomes?.find(o=>o.id===result.id)||{id:result.id,status:entry?.status||'not_searched'};return {id:o.id,status:o.status,reason:o.reason||null};})};
}
function confirm(state,expected){
 const reasons=[],held=[];
 if(expected.schema_version!==2||!Array.isArray(expected.rows)||!Array.isArray(expected.details))throw Error('CONFIRM_V2_FULLROW_EXPECTATIONS_REQUIRED');
 const hasDetails=typeof expected.details_run_id==='string'&&expected.details_run_id.length>0;
 if(hasDetails?!(typeof expected.details_digest==='string'&&/^[a-f0-9]{64}$/.test(expected.details_digest)):(expected.details_run_id!==null||expected.details_digest!==null||expected.details.length!==0||expected.rows.some(spec=>spec.new_details_run!==null)))throw Error('CONFIRM_DETAILS_EXPECTATIONS_INCONSISTENT');
 const log=(state.mail_exchange_log||[]).find(l=>l.run_id===expected.outer_run_id),r=log?.report,commit=Date.parse(log?.at);
 if(!r||r.execution_status!=='succeeded'||r.run_id!==expected.outer_run_id||r.capabilities?.execution_path!=='head_pull'||r.capabilities.purchase_details!==CAPABILITY||!Array.isArray(r.capabilities.exchange_schema_versions)||!r.capabilities.exchange_schema_versions.includes(2)||r.error||r.failed||r.ok===false||log.digest!==expected.exchange_digest||!Number.isFinite(commit)||commit<Date.parse(expected.generated_at))reasons.push('successful_head_exchange_receipt_missing');
 if(hasDetails?(r?.details?.run_id!==expected.details_run_id||r?.details?.input_digest!==expected.details_digest):r?.details!==undefined)reasons.push('details_receipt_mismatch');
 if(finances(state)!==expected.financial_hash)reasons.push('financial_or_expected_ids_mismatch');
 if(stableHash(state.rules)!==expected.rules_hash||stableHash(state.history)!==expected.history_hash)reasons.push('rules_or_owner_history_changed');
 if(state.transactions.length!==expected.rows.length)reasons.push('transaction_row_count_mismatch');
 for(const spec of expected.rows){const t=state.transactions.find(t=>t.id===spec.id);if(!t){reasons.push('expected_row_missing:'+spec.id);continue;}
  if(spec.classification_clock&&Date.parse(t.updated_at)!==commit)reasons.push('classification_commit_clock_mismatch:'+spec.id);
  if(spec.new_details_run)for(const d of (t.purchase_details||[]).slice(spec.prior_details_count))if(d.run_id===spec.new_details_run&&Date.parse(d.at)!==commit)reasons.push('details_commit_clock_mismatch:'+spec.id);
  if(stableHash(spec.protected?t:normalized(t,spec))!==spec.hash)reasons.push('row_content_mismatch:'+spec.id);
 }
 for(const d of expected.details){const o=r?.details?.outcomes?.find(o=>o.id===d.id);if((!o&&!r?.details?.replayed)||(o&&o.status!==d.status))reasons.push('expected_details_outcome_missing:'+d.id);if(['found_unapplied','not_applied','not_found','not_searched'].includes(d.status))held.push(d.id);}
 return {complete:reasons.length===0&&held.length===0,transport_confirmed:reasons.length===0,unapplied_ids:held,reasons};
}
module.exports={expectations,confirm,finances,CAPABILITY};
if(require.main===module){const fs=require('node:fs'),x=JSON.parse(fs.readFileSync(0,'utf8'));const result=confirm(x.state,x.expectations);console.log(JSON.stringify(result));if(!result.complete)process.exitCode=2;}
