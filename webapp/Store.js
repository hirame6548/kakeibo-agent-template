/* Serializer for the original tables, preserving every source field including UI extensions.
 * Cells contain JSON scalars/objects (not formulas); headers are field names.
 * A single spreadsheets.batchUpdate commits all tables and the request journal atomically.
 */
var KakeiboStore = (()=>{
  const BASE={
    transactions:['id','source','card','used_at','merchant_raw','merchant_key','amount_jpy','amount_foreign','currency','category','description','parent_id','detail_msg_id','match_status','candidate_msg_ids','evidence','input_version','confidence','classified_by','status','csv_status','created_at','updated_at'],
    rules:['merchant_key','category','needs_detail','source','hits','updated_at'],
    assets:['month','account','balance','entered_at'],
    csv13_families:['key','card','billing_month','snapshots','summary'],
    csv13_rows:['family_key','entry'],
    csv13_runs:['run_id','part','input'],
    csv_imports:['id','card','billing_month','period_start','period_end','row_count','billed_total','reported_total','created_at'],
    csv_bills:['id','import_id','card','billing_month','row_number','used_at','merchant_raw','amount_jpy','payment_total_raw','payment_index_raw','billed_jpy','memo','foreign_note','purchase_id','status','reason','candidate_purchase_ids'],
    mail_exchange_log:['run_id','at','report'],
    mail_sources:['id','mailbox','message_id','item_ordinal','digest','kind','event_status','purchase_id','candidate_purchase_ids','reason'],
    results_log:['run_id','digest','applied_at','accepted','review','stale','skipped'],
    ui_history:['id','entry'],ui_requests:['id','digest','revision','at'],config:['key','value']
  };
  const NAMES=Object.keys(BASE),OPTIONAL=['csv13_rows','csv13_families','csv13_runs','csv_imports','csv_bills','results_log','mail_sources','mail_exchange_log'];
  function encode(snapshot) {
    const s=snapshot.state;
    const records={csv13_families:(s.csv13_stage?.families||[]).map(({rows,...f})=>f),csv13_rows:(s.csv13_stage?.families||[]).flatMap(f=>f.rows.map(entry=>({family_key:f.key,entry}))),csv13_runs:(s.csv13_stage?.runs||[]).flatMap(r=>Array.from({length:Math.max(1,Math.ceil(r.input.length/20000))},(_,part)=>({run_id:r.run_id,part,input:r.input.slice(part*20000,(part+1)*20000)}))),mail_exchange_log:s.mail_exchange_log||[],mail_sources:s.mail_sources||[],results_log:s.classification_log||[],csv_imports:s.csv?.imports||[],csv_bills:s.csv?.bills||[],transactions:s.transactions,rules:s.rules,assets:s.assets,ui_history:Object.keys(s.history).map(id=>({id,entry:s.history[id]})),ui_requests:snapshot.requests,
      config:[{key:'schema',value:s.csv?2:1},{key:'revision',value:snapshot.revision},{key:'settings',value:s.settings},{key:'metadata',value:s.metadata}]};
    const out={};
    NAMES.forEach(name=>{
      const columns=BASE[name].slice();records[name].forEach(r=>Object.keys(r).forEach(k=>{if(!columns.includes(k))columns.push(k);}));
      out[name]=[columns].concat(records[name].map(r=>columns.map(k=>Object.prototype.hasOwnProperty.call(r,k)?JSON.stringify(r[k]):'')));
      if(out[name].length>10001||columns.length>100||out[name].some(r=>r.some(v=>v.length>45000)))throw new Error('STORAGE_LIMIT');
    });return out;
  }
  function decode(tables,today) {
    const records={};
    NAMES.forEach(name=>{
      const rows=tables[name];if((!rows||!rows.length)&&OPTIONAL.includes(name)){records[name]=[];return;}if(!rows||!rows.length)throw new Error('NOT_INITIALIZED');
      const header=rows[0];if(new Set(header).size!==header.length||BASE[name].some(k=>!header.includes(k)))throw new Error('CORRUPT_HEADERS');
      records[name]=rows.slice(1).filter(r=>r.some(x=>x!=='')).map(row=>{const out={};header.forEach((key,i)=>{const cell=row[i];if(cell!==undefined&&cell!=='')out[key]=JSON.parse(cell);});return out;});
    });
    const cfg={};records.config.forEach(r=>{if(Object.prototype.hasOwnProperty.call(cfg,r.key))throw new Error('CORRUPT_CONFIG');cfg[r.key]=r.value;});
    if(![1,2].includes(cfg.schema)||!Number.isSafeInteger(cfg.revision)||cfg.revision<0)throw new Error('CORRUPT_VERSION');
    const history={};records.ui_history.forEach(r=>{if(Object.prototype.hasOwnProperty.call(history,r.id))throw new Error('CORRUPT_HISTORY');history[r.id]=r.entry;});
    const ids=new Set();records.ui_requests.forEach(r=>{if(ids.has(r.id))throw new Error('CORRUPT_JOURNAL');ids.add(r.id);});
    const state={v:2,as_of:today,transactions:records.transactions,rules:records.rules,assets:records.assets,history,settings:cfg.settings,metadata:cfg.metadata};
    if(cfg.schema===2){if(['csv_imports','csv_bills'].some(n=>!tables[n]?.length))throw new Error('CORRUPT_CSV_TABLES');state.csv={imports:records.csv_imports,bills:records.csv_bills};}
    if(records.csv13_families.length||records.csv13_runs.length){const runs=[];for(const r of records.csv13_runs){let x=runs.find(x=>x.run_id===r.run_id);if(!x){x={run_id:r.run_id,parts:[]};runs.push(x);}if(!Number.isSafeInteger(r.part)||r.part<0||x.parts[r.part]!==undefined)throw Error('CORRUPT_CSV13_RUN');x.parts[r.part]=r.input;}if(runs.some(r=>Array.from({length:r.parts.length},(_,i)=>r.parts[i]).some(x=>typeof x!=='string')))throw Error('CORRUPT_CSV13_RUN');state.csv13_stage={families:records.csv13_families.map(f=>({...f,rows:records.csv13_rows.filter(r=>r.family_key===f.key).map(r=>r.entry)})),runs:runs.map(r=>({run_id:r.run_id,input:r.parts.join('')}))};}
    if(records.results_log.length)state.classification_log=records.results_log;
    if(records.mail_sources.length)state.mail_sources=records.mail_sources;
    if(records.mail_exchange_log.length)state.mail_exchange_log=records.mail_exchange_log;
    return {revision:cfg.revision,requests:records.ui_requests,state:KakeiboCore.validate(state)};
  }
  function requests(tables,sheets) {
    const requests=[];let nextId=Math.max(0,...sheets.map(s=>s.properties.sheetId))+1;
    NAMES.forEach(name=>{
      let p=sheets.find(x=>x.properties.title===name)?.properties;
      const rows=tables[name];
      if(!p&&OPTIONAL.includes(name)){if(rows.length===1)return;p={sheetId:nextId++,title:name,gridProperties:{rowCount:Math.max(100,rows.length),columnCount:Math.max(26,rows[0].length)}};requests.push({addSheet:{properties:p}});}
      if(!p)throw new Error('MISSING_SHEET');
      if(rows.length>p.gridProperties.rowCount||rows[0].length>p.gridProperties.columnCount)requests.push({updateSheetProperties:{properties:{sheetId:p.sheetId,gridProperties:{rowCount:Math.max(rows.length,p.gridProperties.rowCount),columnCount:Math.max(rows[0].length,p.gridProperties.columnCount)}},fields:'gridProperties(rowCount,columnCount)'}});
      requests.push({updateCells:{range:{sheetId:p.sheetId},rows:rows.map(row=>({values:row.map(value=>({userEnteredValue:{stringValue:value}}))})),fields:'userEnteredValue'}});
    });return requests;
  }
  return {NAMES,OPTIONAL,encode,decode,requests};
})();
if(typeof module!=='undefined')module.exports=KakeiboStore;
