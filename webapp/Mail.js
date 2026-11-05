/* Pure mail-source ingestion. No Gmail/network access; verified decoder is a separate boundary.
 * Sources are immutable evidence, purchases are counted once, bills remain independent.
 */
var KakeiboMail=(()=>{
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x)),fail=x=>{throw Error('MAIL_'+x);};
const CATS=['食費','生活用品','住まい・固定費','交通','趣味・娯楽','学業・仕事','医療・保険','その他'],FRAMES=['food','goods','home','transport','hobby','work','medical','other'];
const str=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n;
function sender(s){if(typeof s!=='string')return null;const m=/^(?:[^<>\r\n]*<([^<>\s]+)>|([^<>\s]+))$/.exec(s.trim());return m?(m[1]||m[2]).toLowerCase():null;}
function validDate(s){const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s||'');if(!m)return false;const y=+m[1],mo=+m[2],d=+m[3],v=new Date(Date.UTC(y,mo-1,d));return y>=2000&&v.getUTCFullYear()===y&&v.getUTCMonth()===mo-1&&v.getUTCDate()===d&&(m[4]===undefined||(+m[4]<24&&+m[5]<60));}
function sourceId(m){if(!m||typeof m!=='object')fail('INVALID_ENVELOPE');if(!/^[a-zA-Z0-9_-]{1,80}$/.test(m.mailbox||'')||!/^[a-f0-9]{8,64}$/.test(m.message_id||''))fail('INVALID_SOURCE_ID');return 'mail#'+m.mailbox+'#'+m.message_id;}
function parse(m,tools){const id=sourceId(m);if(!tools||typeof tools.hash!=='function'||typeof tools.parseMessage!=='function'||typeof tools.merchantKey!=='function')fail('MISSING_TOOLS');if(!Array.isArray(tools.allowedMailboxes)||!tools.allowedMailboxes.includes(m.mailbox))fail('MAILBOX_NOT_CONFIGURED');if(!str(m.subject,300)||typeof m.body!=='string'||m.body.length>200000)fail('INVALID_ENVELOPE');
 const from=sender(m.from),digest=tools.hash(JSON.stringify([from,m.subject,m.body,m.authentication,m.decoding]));
 const base={id,mailbox:m.mailbox,message_id:m.message_id,item_ordinal:0,digest,kind:'ignored',event_status:'ignored',purchase_id:null,candidate_purchase_ids:[],reason:'unsupported_subject'};
 const auth=m.authentication;
 // Caller must obtain these attestations from Gmail receiver metadata, never email prose.
 if(!['statement@vpass.ne.jp'].includes(from)||!auth||auth.receiver!=='gmail'||auth.from!==from||auth.dmarc!=='pass'||auth.aligned!==true||auth.verification_method!=='gmail_raw_headers_v1'||! /^[a-f0-9]{64}$/.test(auth.raw_sha256||''))return [{...base,event_status:'quarantined',reason:'sender_or_authentication'}];
 if(!m.decoding||m.decoding.status!=='ok'||!['raw_mime','connector_verified'].includes(m.decoding.source)||!str(m.decoding.charset,80)||(/iso-2022-jp/i.test(m.decoding.charset)&&m.decoding.source!=='raw_mime')||/[\uFFFD\u001b\u0000]/.test(m.body))return [{...base,event_status:'quarantined',reason:'decoding_unverified'}];
 if(m.subject.includes('ご利用確認のお願い')||/決済未完了|利用不可|ご利用を制限|ご利用いただけません|利用できません/.test(m.body))return [{...base,kind:'blocked',event_status:'blocked',reason:'declined_or_restricted_notice'}];
 if(!['ご利用のお知らせ【三井住友カード】','ご利用明細のお知らせ【三井住友カード】'].includes(m.subject))return [base];
 const p=tools.parseMessage({id:m.message_id,from,subject:m.subject,body:m.body});
 if(p.error||!p.transactions.length||p.transactions.length>30)return [{...base,event_status:'parse_error',reason:'unreadable_notification'}];
 const good=p.transactions.every(t=>validDate(t.used_at)&&str(t.merchant_raw,512)&&(t.amount_jpy===null||(Number.isSafeInteger(t.amount_jpy)&&t.amount_jpy>0&&t.amount_jpy<=999999999999))&&(t.amount_foreign===null||(Number.isFinite(t.amount_foreign)&&t.amount_foreign>0&&/^[A-Z]{3}$/.test(t.currency))));
 if(!good)return [{...base,event_status:'parse_error',reason:'invalid_financial_fields'}];
 return p.transactions.map((t,i)=>({...base,id:id+'#'+(i+1),item_ordinal:i+1,kind:p.kind,event_status:!['olive','amazon_master'].includes(t.card)||t.transaction_type!=='買物'?'quarantined':'ready',reason:!['olive','amazon_master'].includes(t.card)?'unknown_card':t.transaction_type!=='買物'?'unsupported_event':null,card:t.card,used_at:t.used_at,used_time:t.used_at.includes('T')?t.used_at.slice(11):null,merchant_raw:t.merchant_raw,merchant_key:tools.merchantKey(t.merchant_raw),transaction_type:t.transaction_type,amount_jpy:t.amount_jpy,amount_foreign:t.amount_foreign,currency:t.currency,financial_status:'unconfirmed'}));
}
const roots=s=>s.transactions.filter(t=>!t.parent_id);
function candidates(s,e){return roots(s).filter(t=>{if(t.card!==e.card)return false;const days=Math.abs(Date.parse(t.used_at.slice(0,10))-Date.parse(e.used_at.slice(0,10)))/86400000;
 if(e.amount_jpy!==null)return days===0&&t.amount_jpy===e.amount_jpy;
 return days<=3&&t.currency===e.currency&&t.amount_foreign===e.amount_foreign;
});}
function distinctTimedAlert(t,e){return e.kind==='card_alert'&&t.source==='card_alert'&&t.mail_source_id&&validDate(t.used_at)&&t.used_at.includes('T')&&e.used_time!==null&&t.used_at!==e.used_at;}
function purchase(e,s,now){const r=s.rules.find(r=>r.merchant_key===e.merchant_key&&r.source==='user'),idx=r&&r.needs_detail===false?FRAMES.indexOf(r.frame):-1;return {id:'purchase#'+e.id,source:e.kind,mail_source_id:e.id,card:e.card,used_at:e.used_at,used_time:e.used_time,merchant_raw:e.merchant_raw,merchant_key:e.merchant_key,amount_jpy:e.amount_jpy,amount_foreign:e.amount_foreign,currency:e.currency,category:idx>=0?CATS[idx]:null,frame:idx>=0?r.frame:null,frame_by:idx>=0?'rule':null,description:null,parent_id:null,detail_msg_id:null,match_status:'not_needed',candidate_msg_ids:[],evidence:'認証確認済み利用通知。利用・請求は未確定',input_version:e.id,confidence:idx>=0?1:0,classified_by:idx>=0?'rule':null,status:idx>=0?'auto':'pending',financial_status:'unconfirmed',csv_status:'pending',created_at:now,updated_at:now};}
function validate(s){if(!s.mail_sources)return;if(!Array.isArray(s.mail_sources))fail('CORRUPT_SOURCES');const ids=new Set();for(const e of s.mail_sources){if(!e||!str(e.id,250)||ids.has(e.id)||!str(e.digest,200)||!['ignored','quarantined','blocked','parse_error','held','registered','linked'].includes(e.event_status)||!Array.isArray(e.candidate_purchase_ids))fail('CORRUPT_SOURCES');ids.add(e.id);if(e.purchase_id&&!s.transactions.some(t=>t.id===e.purchase_id&&!t.parent_id))fail('CORRUPT_LINK');if(['registered','linked'].includes(e.event_status)&&!e.purchase_id)fail('CORRUPT_LINK');if(!['registered','linked'].includes(e.event_status)&&e.purchase_id)fail('CORRUPT_LINK');}}
function plan(before,input,tools,now){if(!input||input.schema_version!==1||!Array.isArray(input.messages)||!input.messages.length||input.messages.length>100||JSON.stringify(input).length>500000)fail('INVALID_BATCH');validate(before);const s=clone(before);s.mail_sources=s.mail_sources||[];const report={registered:0,held:0,blocked:0,quarantined:0,parse_error:0,ignored:0,replayed:0,outcomes:[]};
 for(const m of input.messages){const events=parse(m,tools),prefix=sourceId(m),old=s.mail_sources.filter(e=>e.id===prefix||e.id.startsWith(prefix+'#'));
 if(old.length){if(old.length!==events.length||old.some(e=>!events.some(n=>n.id===e.id&&n.digest===e.digest)))fail('SOURCE_CHANGED');report.replayed+=old.length;continue;}
 // Snapshot before this message preserves multiplicity within a batch notification.
 const prior=clone(s);
 for(const e of events){e.received_at=now;if(e.event_status==='ready'){const possible=candidates(prior,e).filter(t=>!distinctTimedAlert(t,e));e.candidate_purchase_ids=possible.map(t=>t.id);
 if(possible.length){e.event_status='held';e.reason='purchase_identity_unresolved';}
 else {const t=purchase(e,s,now);s.transactions.push(t);e.purchase_id=t.id;e.event_status='registered';}}
 s.mail_sources.push(e);report[e.event_status]++;report.outcomes.push({source_id:e.id,status:e.event_status,reason:e.reason,purchase_id:e.purchase_id,candidate_purchase_ids:e.candidate_purchase_ids});}
 }
 validate(s);return {state:s,report};}
function resolve(before,sourceId,purchaseId,now){validate(before);const s=clone(before),e=s.mail_sources?.find(e=>e.id===sourceId);if(!e||e.event_status!=='held')fail('NOT_HELD');if(purchaseId==='__new__'){const t=purchase(e,s,now);s.transactions.push(t);e.purchase_id=t.id;e.event_status='registered';}
 else {const t=s.transactions.find(t=>t.id===purchaseId);if(!t||!e.candidate_purchase_ids.includes(t.id)||!candidates(s,e).some(t=>t.id===purchaseId))fail('INVALID_PURCHASE_LINK');
 if(s.mail_sources.some(x=>x.id!==e.id&&x.mailbox===e.mailbox&&x.message_id===e.message_id&&x.purchase_id===purchaseId))fail('PURCHASE_USED_TWICE');e.purchase_id=purchaseId;e.event_status='linked';}
 e.resolved_at=now;e.resolved_by='user';validate(s);return s;}
return {parse,plan,resolve,validate};
})();
if(typeof module!=='undefined')module.exports=KakeiboMail;
