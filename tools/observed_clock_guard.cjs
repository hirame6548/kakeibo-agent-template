// Equivalent independent orchestration guard; CLI observed clock is never model input.
'use strict';
function check(state,validated,observedMs){
 const e=validated.confirmation_expectations,reasons=[];
 if(!e||!Number.isFinite(observedMs))throw Error('TRUSTED_OBSERVED_CLOCK_AND_EXPECTATIONS_REQUIRED');
 const date=(value,label)=>{const n=Date.parse(value);if(!Number.isFinite(n)||n>observedMs)reasons.push(label);};
 date(validated.generated_at,'generated_at_invalid_or_future');
 const log=(state.mail_exchange_log||[]).find(l=>l.run_id===e.outer_run_id);
 date(log?.at,'exchange_receipt_at_missing_invalid_or_future');
 for(const spec of e.rows||[]){const t=state.transactions.find(t=>t.id===spec.id);if(spec.classification_clock)date(t?.updated_at,'classification_at_missing_invalid_or_future:'+spec.id);}
 for(const t of state.transactions)for(const d of t.purchase_details||[])if(d.run_id===e.details_run_id)date(d.at,'details_at_missing_invalid_or_future:'+t.id);
 const classRun=validated.exchange?.classification_file?.run_id;
 if(classRun){const log=(state.classification_log||[]).find(l=>l.run_id===classRun);date(log?.applied_at,'classification_log_at_missing_invalid_or_future');}
 return {ok:reasons.length===0,observed_at_utc:new Date(observedMs).toISOString(),reasons};
}
module.exports={check};
if(require.main===module){const fs=require('node:fs'),root=process.argv[2],after=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),validated=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));global.KakeiboCsv13Stage=require(root+'/webapp/Csv13Stage');global.KakeiboCore=require(root+'/webapp/Core');global.KakeiboCsv=require(root+'/webapp/Csv');global.KakeiboMail=require(root+'/webapp/Mail');const today=new Date().toISOString().slice(0,10),state=after.tables?require(root+'/webapp/Store').decode(after.tables,today).state:after.state;if(!state)throw Error('COMPLETE_READBACK_SNAPSHOT_REQUIRED');const result=check(KakeiboCore.validate(state),validated,Date.now());console.log(JSON.stringify(result));if(!result.ok)process.exitCode=2;}
