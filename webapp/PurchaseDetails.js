/* Additive purchase-mail evidence. Never edits classifications, owner notes or money. */
var KakeiboPurchaseDetails=(()=>{
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error('DETAILS_'+c);};
 const text=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
 const fields=(o,allowed)=>o&&Object.keys(o).every(k=>allowed.includes(k));
 function protectedOwner(s,t){return t.classified_by==='user'||t.status==='confirmed'||t.user_locked||t.user_category_lock||!!s.history?.[t.id];}
 function version(t,hash){return 'details-v1-'+hash(JSON.stringify(t));}
 function eligible(s,t){return !protectedOwner(s,t)&&!s.transactions.some(c=>c.parent_id===t.id)&&!(t.purchase_details||[]).some(d=>d.status==='saved');}
 function pending(s,hash,now){return {schema_version:1,mode:'purchase_details',generated_at:now,items:s.transactions.filter(t=>eligible(s,t)).map(t=>({id:t.id,input_version:version(t,hash),used_at:t.used_at,card:t.card,merchant_raw:t.merchant_raw,amount_jpy:t.amount_jpy,amount_foreign:t.amount_foreign,currency:t.currency,existing_category:t.category,existing_description:t.description||null,legacy_match_status:t.match_status||null,legacy_evidence:t.evidence||null,legacy_detail_msg_id:t.detail_msg_id||null,coverage:t.match_status==='matched'&&t.description&&t.evidence&&t.detail_msg_id?'legacy_content_present_needs_audit':'content_missing_or_unverified',prior_attempts:t.purchase_details||[]}))};}
 function plan(before,input,hash,now,allowedMailboxes){
  if(input?.schema_version!==1||input.mode!=='purchase_details'||!text(input.run_id,200)||!Array.isArray(input.results)||input.results.length>200||!fields(input,['schema_version','mode','run_id','results']))fail('ENVELOPE');
  const digest=hash(JSON.stringify(input)),s=clone(before),outcomes=[],seen=new Set();
  const prior=(before.mail_exchange_log||[]).map(x=>x.report?.details).filter(x=>x?.run_id===input.run_id);
  const entries=before.transactions.flatMap(t=>(t.purchase_details||[]).filter(d=>d.run_id===input.run_id));
  if(prior.length||entries.length){if(prior.some(x=>x.input_digest!==digest)||entries.some(x=>x.digest!==digest))fail('RUN_CHANGED');return {state:s,report:{run_id:input.run_id,input_digest:digest,outcomes:[],replayed:true}};}
  const root=t=>{const seen=new Set();while(t.parent_id){if(seen.has(t.id))fail('PARENT_CYCLE');seen.add(t.id);const parent=s.transactions.find(x=>x.id===t.parent_id);if(!parent)break;t=parent;}return t.id;};
  for(const r of input.results){
   if(!r||!fields(r,['id','input_version','match_status','description','evidence','source_message_ids','source_facts','search_performed','source_mailbox'])||!text(r.id,300)||!text(r.input_version,200)||seen.has(r.id)||!['matched','ambiguous','no_candidate','not_searched'].includes(r.match_status)||r.search_performed!==(r.match_status!=='not_searched')||!text(r.evidence,1000)||!Array.isArray(r.source_message_ids)||r.source_message_ids.length>20||r.source_message_ids.some(id=>!text(id,200))||new Set(r.source_message_ids).size!==r.source_message_ids.length||r.description!=null&&!text(r.description,1000))fail('RESULT');
   seen.add(r.id);if(r.match_status==='not_searched'){if(r.source_message_ids.length||r.description)fail('UNSEARCHED_CONTENT');outcomes.push({id:r.id,status:'not_searched'});continue;}
   seen.add(r.id);if(r.match_status==='no_candidate'&&(r.source_message_ids.length||r.description))fail('NO_CANDIDATE_CONTENT');if(r.match_status!=='no_candidate'&&!r.source_message_ids.length)fail('SOURCE_REQUIRED');if(r.match_status==='matched'&&!text(r.description,1000))fail('DESCRIPTION_REQUIRED');
   if(r.source_message_ids.length&&(!Array.isArray(allowedMailboxes)||!allowedMailboxes.includes(r.source_mailbox)))fail('SOURCE_MAILBOX');
   const t=s.transactions.find(t=>t.id===r.id);if(!t){outcomes.push({id:r.id,status:'not_found'});continue;}
   const old=(t.purchase_details||[]).find(d=>d.run_id===input.run_id);if(old){if(old.digest!==digest)fail('RUN_CHANGED');outcomes.push({id:r.id,status:old.status,replayed:true});continue;}
   if(protectedOwner(s,t)||r.input_version!==version(t,hash)){outcomes.push({id:r.id,status:r.source_message_ids.length?'found_unapplied':'not_applied',reason:protectedOwner(s,t)?'owner_protected':'stale'});continue;}
   if(!eligible(s,t)){outcomes.push({id:r.id,status:r.source_message_ids.length?'found_unapplied':'not_applied',reason:'not_eligible'});continue;}
   if(r.source_facts!=null&&(!fields(r.source_facts,['date','date_kind','amount','currency'])||!/^\d{4}-\d{2}-\d{2}$/.test(r.source_facts.date)||!['purchase','shipment','receipt'].includes(r.source_facts.date_kind)||!Number.isFinite(r.source_facts.amount)||!/^[A-Z]{3}$/.test(r.source_facts.currency)))fail('SOURCE_FACTS');
   if(r.match_status==='matched'){
    const f=r.source_facts;if(!fields(f,['date','date_kind','amount','currency'])||!/^\d{4}-\d{2}-\d{2}$/.test(f?.date)||!['purchase','shipment','receipt'].includes(f.date_kind)||!Number.isFinite(f.amount)||!/^[A-Z]{3}$/.test(f.currency))fail('SOURCE_FACTS');
    const amount=f.currency==='JPY'?t.amount_jpy:t.currency===f.currency?t.amount_foreign:null;
    const peers=s.transactions.filter(x=>x.card===t.card&&x.used_at.slice(0,10)===t.used_at.slice(0,10)&&(f.currency==='JPY'?x.amount_jpy===f.amount:x.currency===f.currency&&x.amount_foreign===f.amount));
    if(f.date!==t.used_at.slice(0,10)||amount!==f.amount||new Set(peers.map(root)).size!==1){outcomes.push({id:r.id,status:'found_unapplied',reason:'source_identity_uncertain'});continue;}
   }
   if(r.match_status==='matched'&&s.transactions.some(other=>root(other)!==root(t)&&(other.detail_msg_id&&(!other.detail_mailbox||other.detail_mailbox===r.source_mailbox)&&r.source_message_ids.includes(other.detail_msg_id)||(other.purchase_details||[]).some(d=>d.status==='saved'&&d.source_mailbox===r.source_mailbox&&d.source_message_ids.some(id=>r.source_message_ids.includes(id)))))){outcomes.push({id:r.id,status:'found_unapplied',reason:'source_used_by_other_purchase'});continue;}
   const status=r.match_status==='matched'?'saved':r.match_status==='ambiguous'?'match_uncertain':'mail_not_found';
   const entry={status,description:r.description||null,evidence:r.evidence,source_message_ids:r.source_message_ids.slice(),source_mailbox:r.source_mailbox||null,source_facts:r.source_facts||null};
   if((t.purchase_details||[]).some(d=>JSON.stringify({status:d.status,description:d.description,evidence:d.evidence,source_message_ids:d.source_message_ids,source_mailbox:d.source_mailbox||null,source_facts:d.source_facts||null})===JSON.stringify(entry))){outcomes.push({id:r.id,status,replayed:true});continue;}
   t.purchase_details=(t.purchase_details||[]).concat([{run_id:input.run_id,digest,at:now,...entry}]);outcomes.push({id:r.id,status});
  }
  return {state:s,report:{run_id:input.run_id,input_digest:digest,outcomes}};
 }
 return {pending,plan,version,eligible,SOURCE_ROOT_VERSION:2};
})();
if(typeof module!=='undefined')module.exports=KakeiboPurchaseDetails;
