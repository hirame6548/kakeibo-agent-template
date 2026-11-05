/* Offline deterministic cloud entry. Standard Node modules only; no network or writes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),root=path.resolve(__dirname,'..');
global.KakeiboCsv13Stage=require(path.join(root,'webapp/Csv13Stage'));
const Core=require(path.join(root,'webapp/Core'));global.KakeiboCore=Core;
const Csv=require(path.join(root,'webapp/Csv'));global.KakeiboCsv=Csv;
const Mail=require(path.join(root,'webapp/Mail'));global.KakeiboMail=Mail;
const Classification=require(path.join(root,'webapp/Classification'));global.KakeiboClassification=Classification;
const Billing=require(path.join(root,'webapp/BillingCheck'));global.KakeiboBillingCheck=Billing;
const Exchange=require(path.join(root,'webapp/MailExchange'));global.KakeiboMailExchange=Exchange;
const Details=require(path.join(root,'webapp/PurchaseDetails'));global.KakeiboPurchaseDetails=Details;
const Store=require(path.join(root,'webapp/Store')),Parsers=require(path.join(root,'gas/parsers'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const x=JSON.parse(fs.readFileSync(0,'utf8')),today=new Date(Date.parse(x.generated_at)+9*3600000).toISOString().slice(0,10);
let snapshot;if(x.ledger.tables)snapshot=Store.decode(x.ledger.tables,today);else if(x.ledger.state&&Number.isSafeInteger(x.ledger.revision))snapshot={revision:x.ledger.revision,requests:x.ledger.requests||[],state:Core.validate(x.ledger.state)};else throw Error('CLOUD_LEDGER_REQUIRES_TABLES_OR_VERSIONED_SNAPSHOT');
const tools={...Parsers,hash,allowedMailboxes:x.allowed_mailboxes};
const proposed=x.mail_batch?.messages?.length?Mail.plan(snapshot.state,x.mail_batch,tools,x.generated_at):{state:snapshot.state,report:{registered:0,held:0,blocked:0,quarantined:0,parse_error:0,ignored:0,replayed:0,outcomes:[]}};const pending=Classification.pending(proposed.state,hash,x.generated_at);
const financialKeys=['id','source','card','used_at','merchant_raw','merchant_key','amount_jpy','amount_foreign','currency','parent_id','csv_bill_ids','csv_status','csv_origin'];
const financial=(before,after)=>before.transactions.every(t=>{const u=after.transactions.find(u=>u.id===t.id);return u&&financialKeys.every(k=>JSON.stringify(t[k])===JSON.stringify(u[k]));})&&JSON.stringify(before.csv)===JSON.stringify(after.csv)&&JSON.stringify(before.csv13_stage)===JSON.stringify(after.csv13_stage)&&JSON.stringify(before.assets)===JSON.stringify(after.assets);
const out={schema_version:1,mode:'dry_run',input_revision:snapshot.revision,generated_at:x.generated_at,mail_report:proposed.report,prepared_batch:x.mail_batch,pending,details_pending:Details.pending(proposed.state,hash,x.generated_at),existing_financial_fields_unchanged:financial(snapshot.state,proposed.state),existing_transactions_unchanged:JSON.stringify(snapshot.state.transactions)===JSON.stringify(proposed.state.transactions.slice(0,snapshot.state.transactions.length))};
if(x.operation==='validate'){
 const exchange={schema_version:x.details_file?2:1,run_id:x.run_id,generated_at:x.generated_at,mail_batch:x.mail_batch};
 if(x.classification_file)exchange.classification_file=x.classification_file;
 if(x.details_file){
  const receipt=(snapshot.state.mail_exchange_log||[]).filter(l=>l.report?.execution_status==='succeeded'&&l.report.run_id===l.run_id&&!l.report.error&&!l.report.failed&&l.report.ok!==false&&l.report?.capabilities?.purchase_details===Exchange.CAPABILITY&&l.report.capabilities.execution_path==='head_pull'&&Array.isArray(l.report.capabilities.exchange_schema_versions)&&l.report.capabilities.exchange_schema_versions.includes(2)&&Number.isFinite(Date.parse(l.at))&&Date.parse(l.at)<=Date.parse(x.generated_at)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  const age=receipt?Date.parse(x.generated_at)-Date.parse(receipt.at):NaN;
  if(!Number.isFinite(age)||age<0)throw Error('CLOUD_HEAD_CAPABILITY_SUCCESS_HISTORY_MISSING');
  exchange.required_capability=Exchange.CAPABILITY;exchange.details_file=x.details_file;
 }
 const records=x.source_records||[];
 if(!Array.isArray(records)||records.some(r=>!x.allowed_mailboxes.includes(r.mailbox)||!/^([a-f0-9]{1,32})$/.test(r.message_id)||!/^([a-f0-9]{64})$/.test(r.raw_sha256)||r.verification_method!=='gmail_raw_headers_v1'))throw Error('CLOUD_SOURCE_RECORD_INVALID');
 const requireSource=(mailbox,id)=>{const matches=records.filter(r=>r.message_id===id&&(!mailbox||r.mailbox===mailbox));if(matches.length!==1)throw Error('CLOUD_SOURCE_NOT_VERIFIED_OR_AMBIGUOUS');};
 for(const r of x.details_file?.results||[])for(const id of r.source_message_ids||[])requireSource(r.source_mailbox,id);
 for(const r of x.classification_file?.results||[])if(r.match_status==='matched')requireSource(r.source_mailbox,r.detail_msg_id);
 if(x.details_file)exchange.details_source_records=records;

 if(x.billing_notices?.length)exchange.billing_notices=x.billing_notices;
 const p=Exchange.plan(snapshot.state,exchange,tools,x.generated_at);if(!financial(snapshot.state,p.state))throw Error('CLOUD_EXISTING_FINANCIAL_CHANGE');
 const oldIDs=new Set(snapshot.state.transactions.map(t=>t.id));
 for(const t of snapshot.state.transactions.filter(t=>t.user_locked||t.user_category_lock||t.classified_by==='user'||t.status==='confirmed'||snapshot.state.history[t.id])){if(JSON.stringify(t)!==JSON.stringify(p.state.transactions.find(u=>u.id===t.id)))throw Error('CLOUD_OWNER_CORRECTION_CHANGED');}
 out.confirmation_expectations=require('./confirm_details.cjs').expectations(snapshot.state,p.state,exchange,p.report);
 out.exchange=exchange;out.exchange_report=p.report;out.filename='exchange-'+x.run_id+'.json';out.exchange_sha256=hash(JSON.stringify(exchange));
}else if(x.operation!=='prepare')throw Error('CLOUD_UNKNOWN_OPERATION');
if(!out.existing_financial_fields_unchanged)throw Error('CLOUD_EXISTING_FINANCIAL_CHANGE');
console.log(JSON.stringify(out));
