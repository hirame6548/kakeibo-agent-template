/* Pure SMBC CSV import. No file names, identity header, provider credentials or raw CSV persist.
 * Financial row multiplicity is preserved. Purchase ledger and monthly billing are separate.
 */
var KakeiboCsv=(()=>{
  'use strict';
  const PROFILE='smbc-7-v1',CARDS=['olive','amazon_master'],MAX=999999999999;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const fail=c=>{throw Error('CSV_'+c);};
  const keys=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail('INVALID_SHAPE');};
  const month=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  function date(s){if(typeof s!=='string')fail('INVALID_DATE');const m=/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s.trim());if(!m)fail('INVALID_DATE');const y=+m[1],mo=+m[2],d=+m[3],v=new Date(Date.UTC(y,mo-1,d));if(y<2000||v.getUTCFullYear()!==y||v.getUTCMonth()!==mo-1||v.getUTCDate()!==d)fail('INVALID_DATE');return [m[1],String(mo).padStart(2,'0'),String(d).padStart(2,'0')].join('-');}
  function money(s){s=s.trim().replace(/^[−－]/,'-');if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s))fail('INVALID_AMOUNT');const n=Number(s.replace(/,/g,''));if(!Number.isSafeInteger(n)||Math.abs(n)>MAX)fail('INVALID_AMOUNT');return n;}
  function count(s){const n=String(s).normalize('NFKC').trim();if(['一括','一括払い','1回払い'].includes(n))return 1;const m=/^(\d{1,3})(?:回(?:払い)?)?$/.exec(n);return m&&+m[1]>=1&&+m[1]<=120?+m[1]:null;}
  function tokenize(text){if(typeof text!=='string'||text.length>2000000)fail('FILE_TOO_LARGE');text=text.replace(/^\uFEFF/,'');let rows=[],row=[],v='',quoted=false,afterQuote=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){v+='"';i++;}else{quoted=false;afterQuote=true;}}else v+=c;continue;}
      if(c==='"'){if(v!==''||afterQuote)fail('INVALID_QUOTES');quoted=true;}
      else if(c===','||c==='\n'||c==='\r'){row.push(v);v='';afterQuote=false;if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}}
      else{if(afterQuote)fail('INVALID_QUOTES');v+=c;}
    }if(quoted)fail('INVALID_QUOTES');if(v!==''||row.length||afterQuote){row.push(v);rows.push(row);}return rows;
  }
  // Parse in the browser BEFORE RPC. The first 3-cell identity record is discarded, never returned.
  function parse(text,card,billing_month){if(!CARDS.includes(card)||!month(billing_month))fail('INVALID_CARD_OR_MONTH');const records=tokenize(text);let start=0;
    if(records[0]?.length===3&&!/^\d{4}[/-]/.test(records[0][0]))start=1;
    const rows=[];let reported_total=null,totalSeen=false;
    for(let i=start;i<records.length;i++){
      const r=records[i];if(r.every(x=>x.trim()===''))continue;
      if(r.length!==7)fail('UNSUPPORTED_COLUMNS_ROW_'+(i+1));
      if(r[0].trim()===''){
        if(r.slice(0,5).every(x=>!x.trim())&&r[5].trim()&&!r[6].trim()){if(totalSeen)fail('DUPLICATE_TOTAL');reported_total=money(r[5]);totalSeen=true;continue;}
        if(!totalSeen&&rows.length&&[r[0],r[2],r[3],r[4],r[5]].every(x=>!x.trim())&&/外貨|換算|現地|レート|\b[A-Z]{3}\b/.test(r[1]+' '+r[6])){const last=rows[rows.length-1];last.foreign_note=[last.foreign_note,r[1],r[6]].filter(Boolean).join('\n');continue;}
        fail('UNSUPPORTED_ROW_'+(i+1));
      }
      if(totalSeen)fail('DETAIL_AFTER_TOTAL');
      rows.push({row_number:i+1,used_at:date(r[0]),merchant_raw:r[1],amount_jpy:money(r[2]),payment_total_raw:r[3],payment_index_raw:r[4],billed_jpy:money(r[5]),memo:r[6],foreign_note:''});
    }
    return validateFile({profile:PROFILE,card,billing_month,rows,reported_total});
  }
  function validateFile(f){keys(f,['profile','card','billing_month','rows','reported_total']);if(f.profile!==PROFILE||!CARDS.includes(f.card)||!month(f.billing_month)||!Array.isArray(f.rows)||!f.rows.length||f.rows.length>1000)fail('INVALID_FILE');
    const seen=new Set();for(const r of f.rows){keys(r,['row_number','used_at','merchant_raw','amount_jpy','payment_total_raw','payment_index_raw','billed_jpy','memo','foreign_note']);if(!Number.isInteger(r.row_number)||r.row_number<1||seen.has(r.row_number))fail('INVALID_ROW');seen.add(r.row_number);if(date(r.used_at)!==r.used_at||typeof r.merchant_raw!=='string'||!r.merchant_raw.trim()||r.merchant_raw.length>512||!Number.isSafeInteger(r.amount_jpy)||Math.abs(r.amount_jpy)>MAX||!Number.isSafeInteger(r.billed_jpy)||Math.abs(r.billed_jpy)>MAX||['payment_total_raw','payment_index_raw','memo','foreign_note'].some(k=>typeof r[k]!=='string'||r[k].length>4096))fail('INVALID_ROW');}
    if(f.reported_total!==null&&(!Number.isSafeInteger(f.reported_total)||Math.abs(f.reported_total)>MAX))fail('INVALID_TOTAL');return f;
  }
  const empty=()=>({imports:[],bills:[]});
  function validateLedger(s){if(!s.csv)return;const c=s.csv;if(!Array.isArray(c.imports)||!Array.isArray(c.bills))fail('CORRUPT_LEDGER');const imports=new Set(c.imports.map(x=>x.id)),bills=new Set();for(const b of c.bills){if(bills.has(b.id)||!imports.has(b.import_id)||!['linked','unresolved'].includes(b.status)||!Number.isSafeInteger(b.billed_jpy)||(b.status==='linked'&&!s.transactions.some(t=>t.id===b.purchase_id)))fail('CORRUPT_LEDGER');bills.add(b.id);}
    const parents=new Set(s.transactions.map(t=>t.parent_id).filter(Boolean)),totals={};for(const t of s.transactions.filter(t=>!parents.has(t.id))){const m=t.used_at.slice(0,7);totals[m]=(totals[m]||0)+(t.amount_jpy||0);if(!Number.isSafeInteger(totals[m]))fail('TOTAL_OVERFLOW');}}
  function canonical(r){return [r.used_at,r.merchant_raw,r.amount_jpy,count(r.payment_total_raw)??r.payment_total_raw.normalize('NFKC'),count(r.payment_index_raw)??r.payment_index_raw.normalize('NFKC'),r.billed_jpy,r.memo,r.foreign_note];}
  function signature(t){return [t.card,t.used_at.slice(0,10),t.amount_jpy].join('|');}
  function makePurchase(b,tools,now){const pasmo=/PASMO.*チャージ|チャージ.*PASMO/i.test(b.merchant_raw.normalize('NFKC'));return {id:'csv#'+b.id,source:'csv',card:b.card,used_at:b.used_at,merchant_raw:b.merchant_raw,merchant_key:tools.merchantKey(b.merchant_raw),amount_jpy:b.amount_jpy,amount_foreign:null,currency:null,category:pasmo?'交通':null,description:b.memo||null,parent_id:null,detail_msg_id:null,match_status:'not_needed',candidate_msg_ids:[],evidence:'CSV明細から取込',input_version:b.id,confidence:pasmo?1:0,classified_by:pasmo?'rule':null,status:pasmo?'auto':'review',csv_status:'matched',created_at:now,updated_at:now,csv_origin:{billing_month:b.billing_month,row_number:b.row_number},csv_bill_ids:[b.id]};}
  function matches(t,b){if(t.card!==b.card)return false;if(signature(t)===signature(b))return true;const m=/(?:^|\s)(-?\d+(?:\.\d+)?)\s+([A-Z]{3})(?:\s|$)/.exec((b.memo+' '+b.foreign_note).replace(/\u3000/g,' '));return (t.amount_jpy===null||t.amount_jpy===b.amount_jpy)&&m&&m[2]!=='JPY'&&t.currency===m[2]&&t.amount_foreign===+m[1]&&Math.abs(Date.parse(t.used_at.slice(0,10))-Date.parse(b.used_at))<=3*86400000;}
  function link(t,b){if(t.amount_jpy===null)t.amount_jpy=b.amount_jpy;t.csv_status='matched';t.csv_bill_ids=(t.csv_bill_ids||[]).concat(b.id);b.purchase_id=t.id;b.status='linked';}
  function matching(s,b){const parents=new Set(s.transactions.map(t=>t.parent_id).filter(Boolean));return s.transactions.filter(t=>!parents.has(t.id)&&matches(t,b));}
  function refreshCandidates(s){for(const b of s.csv.bills.filter(x=>x.status==='unresolved')){const used=new Set(s.csv.bills.filter(x=>x.id!==b.id&&x.card===b.card&&x.billing_month===b.billing_month&&x.purchase_id).map(x=>x.purchase_id));b.candidate_purchase_ids=matching(s,b).filter(t=>!used.has(t.id)).map(t=>t.id);}}
  function plan(before,files,tools,now){if(!Array.isArray(files)||!files.length||files.length>12||files.reduce((n,f)=>n+(f.rows?.length||0),0)>2000)fail('BATCH_LIMIT');if(!tools||typeof tools.hash!=='function'||typeof tools.merchantKey!=='function')fail('MISSING_TOOLS');
    const s=clone(before);s.csv=s.csv||empty();validateLedger(s);const report={files:[],created:0,linked:0,unresolved:0,skipped:0,unmatched_notifications:[]};
    // Billing-month order is presentation only; installment linkage always requires an explicit decision.
    for(const input of files.slice().sort((a,b)=>a.billing_month.localeCompare(b.billing_month))){const f=validateFile(input);const sorted=f.rows.map(r=>({row:r,key:JSON.stringify(canonical(r))})).sort((a,b)=>(a.key<b.key?-1:a.key>b.key?1:0)||a.row.row_number-b.row.row_number);
      const billedTotal=f.rows.reduce((n,r)=>n+r.billed_jpy,0);if(!Number.isSafeInteger(billedTotal))fail('TOTAL_OVERFLOW');if(f.reported_total!==null&&f.reported_total!==billedTotal)fail('BILL_TOTAL_MISMATCH');
      // Legacy hashes lost non-ASCII bytes. Compare the COMPLETE stored financial row multiset,
      // never the old hash alone. Keep all existing IDs/links/history unchanged; no migration write.
      const existing=s.csv.imports.filter(x=>x.card===f.card&&x.billing_month===f.billing_month);
      if(existing.length){if(existing.length!==1)fail('CORRUPT_LEDGER');const entry=existing[0],saved=s.csv.bills.filter(b=>b.import_id===entry.id).map(b=>JSON.stringify(canonical(b))).sort();
        if(saved.length!==entry.row_count||saved.length!==f.rows.length||JSON.stringify(saved)!==JSON.stringify(sorted.map(x=>x.key)))fail('STATEMENT_CHANGED_REVIEW');
        report.skipped++;report.files.push({id:entry.id,card:f.card,billing_month:f.billing_month,status:'already_imported'});continue;}
      const fingerprint='u8v2-'+tools.hash(JSON.stringify([PROFILE,f.card,f.billing_month,sorted.map(x=>x.key)]));const id='import#'+fingerprint;
      const dates=f.rows.map(r=>r.used_at).sort();const entry={id,card:f.card,billing_month:f.billing_month,period_start:dates[0],period_end:dates[dates.length-1],row_count:f.rows.length,billed_total:billedTotal,reported_total:f.reported_total,created_at:now};s.csv.imports.push(entry);
      const multiplicity={};f.rows.forEach(r=>{const k=signature({...r,card:f.card});multiplicity[k]=(multiplicity[k]||0)+1;});
      for(let i=0;i<sorted.length;i++){const r=sorted[i].row,b={...clone(r),id:fingerprint+'#'+(i+1),import_id:id,card:f.card,billing_month:f.billing_month,purchase_id:null,status:'unresolved',reason:null,candidate_purchase_ids:[]};
        const total=count(r.payment_total_raw),index=count(r.payment_index_raw)||((total===1&&!r.payment_index_raw.trim())?1:null);b.payment_total=total;b.payment_index=index;
        const candidates=matching(s,b).filter(t=>!t.id.startsWith('csv#'+fingerprint+'#')),isLater=total!==null&&total>1&&index!==null&&index>1;
        const usedInStatement=new Set(s.csv.bills.filter(x=>x.card===b.card&&x.billing_month===b.billing_month&&x.purchase_id).map(x=>x.purchase_id));
        b.candidate_purchase_ids=candidates.filter(t=>!usedInStatement.has(t.id)).map(t=>t.id);
        // A unique notification can be reconciled by card/date/amount; never guess among duplicates.
        const notice=candidates.filter(t=>t.source!=='csv'&&!usedInStatement.has(t.id));
        const existingCsv=candidates.some(t=>t.source==='csv');
        if(total===null||index===null||index>total)b.reason='payment_terms_unknown';
        else if(isLater)b.reason='installment_purchase_link';
        else if(candidates.length&&(!existingCsv&&notice.length===1&&!notice[0].mail_source_id&&!(notice[0].csv_bill_ids||[]).length&&multiplicity[signature(b)]===1)){
          const t=notice[0];link(t,b);report.linked++;
        }else if(candidates.length&&(existingCsv||notice.length))b.reason='ambiguous_purchase';
        else {const t=makePurchase(b,tools,now);s.transactions.push(t);b.purchase_id=t.id;b.status='linked';report.created++;}
        if(b.status==='unresolved')report.unresolved++;s.csv.bills.push(b);
      }
      report.files.push({...entry,status:'ready',missing_total:f.reported_total===null});
    }
    refreshCandidates(s);
    for(const f of report.files.filter(f=>f.status==='ready')){const linked=new Set(s.csv.bills.filter(b=>b.import_id===f.id&&b.purchase_id).map(b=>b.purchase_id));const possible=new Set(s.csv.bills.filter(b=>b.import_id===f.id&&b.status==='unresolved').flatMap(b=>b.candidate_purchase_ids));for(const t of before.transactions.filter(t=>['card_alert','card_batch'].includes(t.source)&&t.card===f.card&&t.used_at.slice(0,10)>=f.period_start&&t.used_at.slice(0,10)<=f.period_end)){if(!linked.has(t.id)&&!possible.has(t.id))report.unmatched_notifications.push({id:t.id,card:f.card,billing_month:f.billing_month,used_at:t.used_at,amount_jpy:t.amount_jpy});}}
    validateLedger(s);return {state:s,report};
  }
  function resolve(before,billId,purchaseId,tools,now){const s=clone(before),b=s.csv?.bills.find(x=>x.id===billId);if(!b||b.status!=='unresolved')fail('NOT_UNRESOLVED');
    if(purchaseId==='__new__'){const t=makePurchase(b,tools,now);s.transactions.push(t);b.purchase_id=t.id;}
    else {if(!b.candidate_purchase_ids.includes(purchaseId))fail('INVALID_PURCHASE_LINK');const t=s.transactions.find(x=>x.id===purchaseId);if(!t||!matches(t,b))fail('INVALID_PURCHASE_LINK');if(s.csv.bills.some(x=>x.id!==b.id&&x.card===b.card&&x.billing_month===b.billing_month&&x.purchase_id===purchaseId))fail('PURCHASE_USED_TWICE');link(t,b);}
    b.status='linked';b.resolved_at=now;b.resolved_by='user';refreshCandidates(s);validateLedger(s);return s;
  }
  return {PROFILE,parse,tokenize,validateFile,validateLedger,plan,resolve,count};
})();
if(typeof module!=='undefined')module.exports=KakeiboCsv;
