/* Pure statement-total comparison. No mail/web fetch, ledger mutation or adjustment rows.
 * Input items are monthly BILLS, never purchase-date expense totals or authorizations.
 */
var KakeiboBillingCheck=(()=>{
'use strict';
const CARDS=['olive','amazon_master'],KINDS=['purchase','installment','refund','fee','other'];
const month=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const money=n=>Number.isSafeInteger(n)&&Math.abs(n)<=999999999999;
const fail=x=>{throw Error('BILLING_CHECK_'+x);};
function normalizeNotice(n){
 if(!n||!CARDS.includes(n.card_id)&&n.card_id!==null||!['confirmed','scheduled','changed','link_only','unknown'].includes(n.notice_status)||typeof n.source_message_id!=='string'||!n.source_message_id||(n.billed_total!==null&&!money(n.billed_total)))fail('INVALID_NOTICE');
 const issues=[];if(n.card_id===null)issues.push('card_unknown');
 if(n.payment_due_date!==null){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(n.payment_due_date||'');const d=m&&new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(!m||d.toISOString().slice(0,10)!==n.payment_due_date)fail('INVALID_DUE_DATE');}else issues.push('payment_due_date_missing');
 if(n.billed_total===null)issues.push('total_missing');if(n.currency!=='JPY')issues.push('currency_unknown_or_unsupported');
 if(n.notice_status==='link_only'&&n.billed_total!==null)fail('LINK_ONLY_HAS_AMOUNT');
 return {comparable:issues.length===0,issues,statement:issues.length?null:{card:n.card_id,billing_month:n.payment_due_date.slice(0,7),total_jpy:n.billed_total,amount_status:'listed',source_id:n.source_message_id,notice_status:n.notice_status},notice:{card_id:n.card_id,payment_due_date:n.payment_due_date,billed_total:n.billed_total,currency:n.currency,source_message_id:n.source_message_id,notice_status:n.notice_status}};
}
function compare(input){
 if(!input||!input.statement||!Array.isArray(input.billing_items)||input.billing_items.length>10000||!['complete','partial','unknown'].includes(input.coverage))fail('INVALID_INPUT');
 const st=input.statement;if(!['confirmed','scheduled','changed','link_only','unknown'].includes(st.notice_status))fail('INVALID_NOTICE_STATUS');if(!CARDS.includes(st.card)||!month(st.billing_month)||!['listed','not_listed'].includes(st.amount_status)||typeof st.source_id!=='string'||!st.source_id||st.source_id.length>250||(st.amount_status==='listed'?!money(st.total_jpy):st.total_jpy!==null))fail('INVALID_STATEMENT');
 const ids=new Set(),totals=Object.fromEntries(KINDS.map(k=>[k,0])),issues=[],target=[];let excluded=0;
 for(const item of input.billing_items){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||!CARDS.includes(item.card)||(item.billing_month!==null&&!month(item.billing_month))||!KINDS.includes(item.kind)||!['confirmed','unconfirmed'].includes(item.certainty)||(item.billed_jpy!==null&&!money(item.billed_jpy)))fail('INVALID_BILL');ids.add(item.id);
 if(item.card!==st.card||(item.billing_month!==null&&item.billing_month!==st.billing_month)){excluded++;continue;}
 if(item.kind==='refund'&&item.billed_jpy>0||['purchase','installment','fee'].includes(item.kind)&&item.billed_jpy<0)fail('INVALID_SIGN');
 target.push(item);if(item.billing_month===null){issues.push({id:item.id,reason:'billing_month_unknown'});continue;}
 if(item.billed_jpy===null){issues.push({id:item.id,reason:'billing_amount_unknown'});continue;}
 totals[item.kind]+=item.billed_jpy;if(!money(totals[item.kind]))fail('TOTAL_OVERFLOW');if(item.certainty==='unconfirmed')issues.push({id:item.id,reason:'billing_unconfirmed'});
 }
 const known=Object.values(totals).reduce((n,v)=>n+v,0);if(!money(known))fail('TOTAL_OVERFLOW');
 const result={schema_version:1,card:st.card,billing_month:st.billing_month,statement_source_id:st.source_id,statement_total_jpy:st.total_jpy,coverage:input.coverage,status:'not_comparable',known_billed_total_jpy:known,breakdown_jpy:totals,compared_item_count:target.length,excluded_item_count:excluded,issues,difference_jpy:null,investigation_required:false,reasons:[]};
 if(st.amount_status==='not_listed'){result.status='unverified';result.reasons=['statement_amount_not_listed'];return result;}
 if(issues.some(x=>['billing_month_unknown','billing_amount_unknown'].includes(x.reason))){result.reasons=['monthly_billing_inputs_incomplete'];result.investigation_required=true;return result;}
 const diff=st.total_jpy-known;if(!money(diff))fail('TOTAL_OVERFLOW');result.difference_jpy=diff;
 if(input.coverage!=='complete'||issues.length||st.notice_status!=='confirmed'){result.status='provisional';result.reasons=[...(input.coverage!=='complete'?['billing_coverage_'+input.coverage]:[]),...(issues.length?['unconfirmed_billing_items']:[]),...(st.notice_status!=='confirmed'?['statement_'+st.notice_status]:[])];result.investigation_required=true;}
 else if(diff===0){result.status='matched';}
 else {result.status='difference';result.investigation_required=true;result.reasons=['statement_detail_investigation_required'];}
 return result;
}
function selectNotice(previous,incoming){
 normalizeNotice(incoming);if(previous)normalizeNotice(previous);
 const result={decision:'candidate',current:previous||null,candidate:incoming,source_history:previous?[previous,incoming]:[incoming]};
 if(!previous){if(normalizeNotice(incoming).comparable&&incoming.notice_kind==='initial'){result.decision='initial';result.current=incoming;result.candidate=null;}return result;}
 if(previous.source_message_id===incoming.source_message_id){if(JSON.stringify(previous)!==JSON.stringify(incoming))fail('SOURCE_REUSED');return {...result,decision:'replayed',candidate:null,source_history:[previous]};}
 if(previous.card_id!==incoming.card_id||previous.payment_due_date!==incoming.payment_due_date||!normalizeNotice(incoming).comparable)return result;
 const timestamp=n=>typeof n.issued_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(n.issued_at)&&Number.isFinite(Date.parse(n.issued_at))?Date.parse(n.issued_at):null;
 const oldTime=timestamp(previous),newTime=timestamp(incoming);if(oldTime===null||newTime===null)return result;
 if(newTime<=oldTime)return {...result,decision:'stale',candidate:null};
 // Replacement requires an explicit verified correction relation; chronology alone is insufficient.
 if(incoming.notice_kind==='correction'&&incoming.replaces_source_message_id===previous.source_message_id){result.decision='replace';result.current=incoming;result.candidate=null;}
 return result;
}
return {compare,normalizeNotice,selectNotice};
})();
if(typeof module!=='undefined')module.exports=KakeiboBillingCheck;
