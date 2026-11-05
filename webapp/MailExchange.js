/* One immutable private Drive JSON -> one atomic ledger command. No network here. */
var KakeiboMailExchange=(()=>{
'use strict';
const CAPABILITY='purchase-details-v5-fullrow-verified-readback';
function capabilities(){if(typeof KakeiboClassification==='undefined'||KakeiboClassification.SOURCE_ROOT_VERSION!==5||typeof KakeiboPurchaseDetails==='undefined'||KakeiboPurchaseDetails.SOURCE_ROOT_VERSION!==2)throw Error('MAIL_EXCHANGE_INCOMPLETE_CAPABILITY');return {exchange_schema_versions:[1,2],purchase_details:CAPABILITY};}
function plan(before,input,tools,now){const fail=x=>{throw Error('MAIL_EXCHANGE_'+x);};if(!input||![1,2].includes(input.schema_version)||typeof input.run_id!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(input.run_id)||typeof input.generated_at!=='string'||!Number.isFinite(Date.parse(input.generated_at))||Date.parse(input.generated_at)>Date.parse(now)+300000||JSON.stringify(input).length>500000)fail('INVALID_ENVELOPE');
 if((input.details_file||input.schema_version===2)&&(input.schema_version!==2||input.required_capability!==CAPABILITY))fail('DETAILS_CAPABILITY_REQUIRED');
 if(input.schema_version===2){const records=input.details_source_records;if(!Array.isArray(records)||records.length>100||records.some(r=>!tools.allowedMailboxes?.includes(r.mailbox)||!/^([a-f0-9]{1,32})$/.test(r.message_id)||!/^([a-f0-9]{64})$/.test(r.raw_sha256)||r.verification_method!=='gmail_raw_headers_v1'))fail('DETAILS_SOURCE_RECORD');for(const r of input.details_file?.results||[])for(const id of r.source_message_ids||[])if(records.filter(x=>x.mailbox===r.source_mailbox&&x.message_id===id).length!==1)fail('DETAILS_SOURCE_NOT_VERIFIED');for(const r of input.classification_file?.results||[])if(r.match_status==='matched'&&records.filter(x=>x.message_id===r.detail_msg_id&&(!r.source_mailbox||x.mailbox===r.source_mailbox)).length!==1)fail('CLASSIFICATION_SOURCE_NOT_VERIFIED');}
 const digest='u8v1:'+tools.hash(JSON.stringify(input)),old=(before.mail_exchange_log||[]).find(x=>x.run_id===input.run_id);if(old){if(old.digest!==digest)fail('RUN_ID_REUSED');return {state:JSON.parse(JSON.stringify(before)),report:{run_id:input.run_id,replayed:true}};}
 const messages=input.mail_batch?.messages||[];if(input.mail_batch&&input.mail_batch.schema_version!==1)fail('INVALID_BATCH');if(!Array.isArray(messages)||messages.length>100)fail('INVALID_BATCH');
 if(!messages.length&&!input.classification_file&&!input.details_file&&!input.billing_notices?.length)fail('EMPTY');
 let state=JSON.parse(JSON.stringify(before)),report={run_id:input.run_id,execution_status:'succeeded',mail:null,classification:null,billing:[],capabilities:{...capabilities(),execution_path:tools.executionPath||'other'}};
 // generated_at is the stable proposal time: preview/dry-run and later import share input versions.
 if(messages.length){const p=KakeiboMail.plan(state,input.mail_batch,tools,input.generated_at);state=p.state;report.mail=p.report;}
 if(input.details_file){const p=KakeiboPurchaseDetails.plan(state,input.details_file,tools.hash,now,tools.allowedMailboxes);state=p.state;report.details=p.report;}
 if(input.classification_file){if(input.classification_file.classification_mode!=='provisional')fail('CLASSIFICATION_MODE');const p=KakeiboClassification.plan(state,input.classification_file,tools.hash,now,tools.allowedMailboxes);state=p.state;report.classification=p.report;}
 if(input.billing_notices){if(!Array.isArray(input.billing_notices)||input.billing_notices.length>20)fail('BILLING_LIMIT');for(const n of input.billing_notices){const normalized=KakeiboBillingCheck.normalizeNotice(n);report.billing.push(normalized.comparable?{notice:normalized.notice,status:'not_comparable',reasons:['billing_coverage_not_verified']}:{notice:normalized.notice,status:'unverified',reasons:normalized.issues});}}
 if(JSON.stringify(report).length>40000)fail('REPORT_LIMIT');return {state,report};
}
return {plan,capabilities,CAPABILITY};
})();
if(typeof module!=='undefined')module.exports=KakeiboMailExchange;
