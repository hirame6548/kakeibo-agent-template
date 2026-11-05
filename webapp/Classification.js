/* Pure classification exchange. No Gmail/Drive/API access; the GAS owner validates every write. */
var KakeiboClassification=(()=>{
'use strict';
const CATS=['食費','生活用品','住まい・固定費','交通','趣味・娯楽','学業・仕事','医療・保険','その他'];
const FRAMES=['food','goods','home','transport','hobby','work','medical','other'];
const clone=x=>JSON.parse(JSON.stringify(x)),fail=x=>{throw Error('CLASSIFY_'+x);};
const str=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n;
const leaves=s=>{const parents=new Set(s.transactions.map(t=>t.parent_id).filter(Boolean));return s.transactions.filter(t=>!parents.has(t.id));};
function eligible(s,t,provisional=false){return ['pending','review'].includes(t.status)&&t.category==null&&!t.frame&&t.classified_by!=='user'&&!t.user_locked&&!s.history[t.id]&&!t.user_category_lock&&(!t.classification_result||provisional);}
function rule(s,t){return s.rules.find(r=>r.merchant_key===t.merchant_key)||null;}
function needsDetail(s,t){const r=rule(s,t);if(r)return r.needs_detail!==false;return /AMAZON|アマゾン|メルカリ/i.test(String(t.merchant_key||t.merchant_raw).normalize('NFKC'));}
function categoriesVersion(s,hash){return 'c8-'+hash(JSON.stringify([CATS,FRAMES,s.metadata.categories]));}
function version(s,t,hash){return 'class-v1-'+hash(JSON.stringify([t.id,t.used_at,t.merchant_raw,t.amount_jpy,t.amount_foreign,t.currency,t.card,needsDetail(s,t),categoriesVersion(s,hash),t.status,t.updated_at||null,rule(s,t)]));}
function pending(s,hash,now){return {schema_version:1,classification_mode:'provisional',generated_at:now,categories_version:categoriesVersion(s,hash),categories:CATS.slice(),auto_threshold:s.settings.autoThreshold??0.8,items:leaves(s).filter(t=>eligible(s,t,true)).map(t=>({id:t.id,input_version:version(s,t,hash),used_at:t.used_at,merchant_raw:t.merchant_raw,amount_jpy:t.amount_jpy,amount_foreign:t.amount_foreign,currency:t.currency,card:t.card,needs_detail:needsDetail(s,t),user_rule_category:rule(s,t)?.frame?CATS[FRAMES.indexOf(rule(s,t).frame)]:null}))};}
function parse(input){let f=input;if(typeof f==='string'){if(f.length>500000)fail('FILE_TOO_LARGE');try{f=JSON.parse(f);}catch(e){fail('INVALID_JSON');}}if(!f||f.schema_version!==1||!str(f.run_id,200)||!Array.isArray(f.results)||f.results.length>2000)fail('INVALID_FILE');if(JSON.stringify(f).length>500000)fail('FILE_TOO_LARGE');for(const r of f.results)if(!r||!str(r.id,300)||!str(r.input_version,200))fail('INVALID_RESULT');return f;}
function purchaseRoot(s,t){const seen=new Set();while(t.parent_id){if(seen.has(t.id))fail('PARENT_CYCLE');seen.add(t.id);const parent=s.transactions.find(x=>x.id===t.parent_id);if(!parent)break;t=parent;}return t.id;}
function plan(before,input,hash,now,allowedMailboxes){const f=parse(input),provisional=f.classification_mode==='provisional',s=clone(before),digest='u8v1:'+hash(JSON.stringify(f)),logs=s.classification_log||[],old=logs.find(x=>x.run_id===f.run_id),report={run_id:f.run_id,auto:0,review:0,provisional:0,stale:0,skipped:0,split:0,outcomes:[],replayed:false};
if(old){if(old.digest!==digest)fail('RUN_ID_REUSED');report.replayed=true;return {state:s,report};}
const targets=new Map(leaves(s).map(t=>[t.id,t])),current=r=>{const t=targets.get(r.id);return t&&eligible(s,t,provisional)&&r.input_version===version(s,t,hash);};
const mailTargets=f.results.filter(current).filter(r=>r.match_status==='matched'&&str(r.detail_msg_id,200)).map(r=>({id:r.detail_msg_id,mailbox:r.source_mailbox||null,root:purchaseRoot(s,targets.get(r.id))}));
const used=new Map(),reserve=(id,root,mailbox)=>{if(!used.has(id))used.set(id,[]);used.get(id).push({root,mailbox:mailbox||null});};for(const t of before.transactions){const root=purchaseRoot(before,t);if(t.detail_msg_id)reserve(t.detail_msg_id,root,t.detail_mailbox);for(const d of t.purchase_details||[])if(d.status==='saved')for(const id of d.source_message_ids||[])reserve(id,root,d.source_mailbox);}
const done=new Set(),threshold=s.settings.autoThreshold??0.8;if(typeof threshold!=='number'||threshold<0||threshold>1)fail('INVALID_THRESHOLD');
for(const r of f.results){const t=targets.get(r.id),out={id:r.id,outcome:'skipped',reason:'not_eligible'};
if(!t||done.has(r.id)||!eligible(s,t,provisional)){report.skipped++;report.outcomes.push(out);continue;}
if(r.input_version!==version(s,t,hash)){report.stale++;report.outcomes.push({...out,outcome:'stale',reason:'input_version'});continue;}
done.add(r.id);let reason=null;const matched=r.match_status==='matched',allowedMatch=['matched','ambiguous','no_candidate','not_needed'].includes(r.match_status),cat=CATS.indexOf(r.category),mail=matched&&str(r.detail_msg_id,200)?r.detail_msg_id:null;
if(!allowedMatch||(matched&&!mail)||(!matched&&r.detail_msg_id!=null))reason='invalid_match';
else if(r.source_mailbox!=null&&(!Array.isArray(allowedMailboxes)||!allowedMailboxes.includes(r.source_mailbox)))reason='invalid_match';
else if(r.match_status==='ambiguous')reason='ambiguous';
else if(needsDetail(s,t)&&!matched)reason='detail_required';
else if(mail&&(mailTargets.some(x=>x.id===mail&&x.root!==purchaseRoot(s,t)&&(!x.mailbox||!r.source_mailbox||x.mailbox===r.source_mailbox))||(used.has(mail)&&used.get(mail).some(x=>x.root!==purchaseRoot(s,t)&&(!x.mailbox||!r.source_mailbox||x.mailbox===r.source_mailbox)))))reason='detail_reused';
else if(cat<0)reason='category';
else if(rule(s,t)?.frame&&FRAMES[cat]!==rule(s,t).frame)reason='user_rule_conflict';
else if(typeof r.confidence!=='number'||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1||r.confidence<threshold)reason='confidence';
if(!str(r.description||'',1000)&&r.description!=null&&r.description!=='')reason=reason||'invalid_text';
if(!str(r.evidence||'',1000)&&r.evidence!=null&&r.evidence!=='')reason=reason||'invalid_text';
const candidates=Array.isArray(r.candidate_msg_ids)&&r.candidate_msg_ids.every(x=>str(x,200))?[...new Set(r.candidate_msg_ids)].slice(0,30):[];
const items=Array.isArray(r.items)?r.items:[],validItems=items.length>1&&items.length<=100&&items.every(x=>x&&CATS.includes(x.category)&&Number.isSafeInteger(x.amount_jpy)&&x.amount_jpy>0&&str(x.description,1000)),balanced=validItems&&items.reduce((n,x)=>n+x.amount_jpy,0)===t.amount_jpy;
if(provisional&&!t.classification_prior){t.classification_prior={};for(const k of ['category','frame','frame_by','classified_by','status','classification_result','classification_suggestion','description','evidence','confidence','match_status','detail_msg_id','candidate_msg_ids'])if(Object.prototype.hasOwnProperty.call(t,k))t.classification_prior[k]=clone(t[k]);}
t.match_status=allowedMatch?r.match_status:'no_candidate';t.candidate_msg_ids=candidates;t.confidence=typeof r.confidence==='number'&&Number.isFinite(r.confidence)?r.confidence:0;t.updated_at=now;t.classification_result={run_id:f.run_id,input_version:r.input_version,outcome:reason?'review':'auto',reason};
// Suspect detail IDs never become assigned evidence. Suggestions never create store rules.
if(mail&&!reason){t.detail_msg_id=mail;if(r.source_mailbox)t.detail_mailbox=r.source_mailbox;else delete t.detail_mailbox;reserve(mail,purchaseRoot(s,t),r.source_mailbox);}else if(reason==='detail_reused'||reason==='invalid_match'){t.detail_msg_id=null;t.match_status='ambiguous';}
if(str(r.description,1000))t.description=r.description;if(str(r.evidence,1000))t.evidence=r.evidence;
if(reason&&provisional){const chosen=rule(s,t)?.frame?FRAMES.indexOf(rule(s,t).frame):(cat<0?7:cat);t.category=CATS[chosen];t.frame=FRAMES[chosen];t.frame_by='provisional';t.classified_by='worker';t.status='provisional';t.classification_result.outcome='provisional';t.classification_suggestion={category:cat<0?null:r.category,reason};report.provisional++;out.outcome='provisional';out.reason=reason;}
else if(reason){t.status='review';t.classification_suggestion={category:cat<0?null:r.category,reason};report.review++;out.outcome='review';out.reason=reason;}
else{t.category=r.category;t.frame=FRAMES[cat];t.frame_by='worker';t.classified_by='worker';t.status='auto';report.auto++;out.outcome='auto';out.reason='validated';
if(balanced){items.forEach((item,i)=>{const child={...clone(t),id:t.id+'#item'+(i+1),parent_id:t.id,category:item.category,frame:FRAMES[CATS.indexOf(item.category)],amount_jpy:item.amount_jpy,description:item.description};delete child.csv_bill_ids;delete child.csv_origin;if(s.transactions.some(x=>x.id===child.id))fail('CHILD_ID_COLLISION');s.transactions.push(child);});report.split++;}else if(items.length)out.split='not_applied_unbalanced_or_invalid';}
report.outcomes.push(out);}
s.classification_log=logs.concat([{run_id:f.run_id,digest,applied_at:now,accepted:report.auto,review:report.review,provisional:report.provisional,stale:report.stale,skipped:report.skipped}]);return {state:s,report};}
return {CATS,FRAMES,pending,parse,plan,version,eligible,purchaseRoot,SOURCE_ROOT_VERSION:5};
})();
if(typeof module!=='undefined')module.exports=KakeiboClassification;
