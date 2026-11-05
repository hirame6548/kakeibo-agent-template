/* One immutable private Drive JSON -> one atomic ledger command. No network here. */
var KakeiboMailExchange=(()=>{
'use strict';
function plan(before,input,tools,now){const fail=x=>{throw Error('MAIL_EXCHANGE_'+x);};if(!input||input.schema_version!==1||typeof input.run_id!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(input.run_id)||typeof input.generated_at!=='string'||!Number.isFinite(Date.parse(input.generated_at))||Date.parse(input.generated_at)>Date.parse(now)+300000||JSON.stringify(input).length>500000)fail('INVALID_ENVELOPE');
 const digest='u8v1:'+tools.hash(JSON.stringify(input)),old=(before.mail_exchange_log||[]).find(x=>x.run_id===input.run_id);if(old){if(old.digest!==digest)fail('RUN_ID_REUSED');return {state:JSON.parse(JSON.stringify(before)),report:{run_id:input.run_id,replayed:true}};}
 const messages=input.mail_batch?.messages||[];if(input.mail_batch&&input.mail_batch.schema_version!==1)fail('INVALID_BATCH');if(!Array.isArray(messages)||messages.length>100)fail('INVALID_BATCH');
 if(!messages.length&&!input.classification_file&&!input.details_file&&!input.billing_notices?.length)fail('EMPTY');
 let state=JSON.parse(JSON.stringify(before)),report={run_id:input.run_id,mail:null,classification:null,billing:[]};
 // generated_at is the stable proposal time: preview/dry-run and later import share input versions.
 if(messages.length){const p=KakeiboMail.plan(state,input.mail_batch,tools,input.generated_at);state=p.state;report.mail=p.report;}
 if(input.details_file){const p=KakeiboPurchaseDetails.plan(state,input.details_file,tools.hash,now,tools.allowedMailboxes);state=p.state;report.details=p.report;}
 if(input.classification_file){if(input.classification_file.classification_mode!=='provisional')fail('CLASSIFICATION_MODE');const p=KakeiboClassification.plan(state,input.classification_file,tools.hash,now);state=p.state;report.classification=p.report;}
 if(input.billing_notices){if(!Array.isArray(input.billing_notices)||input.billing_notices.length>20)fail('BILLING_LIMIT');for(const n of input.billing_notices){const normalized=KakeiboBillingCheck.normalizeNotice(n);report.billing.push(normalized.comparable?{notice:normalized.notice,status:'not_comparable',reasons:['billing_coverage_not_verified']}:{notice:normalized.notice,status:'unverified',reasons:normalized.issues});}}
 if(JSON.stringify(report).length>40000)fail('REPORT_LIMIT');return {state,report};
}
return {plan};
})();
if(typeof module!=='undefined')module.exports=KakeiboMailExchange;
