/* Owner-only HTML-service entry points. No doPost, arbitrary URL/file IDs or browser tokens. */
function configuration_() {
  const p=PropertiesService.getScriptProperties().getProperties();
  if(!p.LEDGER_SPREADSHEET_ID||!p.OWNER_EMAIL||!['personal','demo'].includes(p.LEDGER_MODE))throw new Error('NOT_CONFIGURED');
  const effective=Session.getEffectiveUser().getEmail(),active=Session.getActiveUser().getEmail();
  if(!effective||!active||effective.toLowerCase()!==p.OWNER_EMAIL.toLowerCase()||active.toLowerCase()!==p.OWNER_EMAIL.toLowerCase())throw new Error('OWNER_ONLY');
  return p;
}
function today_(){return Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd');}
function doGet(){
  configuration_();
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('家計簿')
    .addMetaTag('viewport','width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable','yes');
}
function lock_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('BUSY');try{return fn();}finally{lock.releaseLock();}}
function sheets_(id){return Sheets.Spreadsheets.get(id,{fields:'sheets(properties)'}).sheets;}
function read_(p){
  const props=sheets_(p.LEDGER_SPREADSHEET_ID);
  const col=n=>{let s='';while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);}return s;};
  const names=KakeiboStore.NAMES.filter(n=>!KakeiboStore.OPTIONAL.includes(n)||props.some(s=>s.properties.title===n));
  const ranges=names.map(n=>{const x=props.find(s=>s.properties.title===n);if(!x)throw new Error('NOT_INITIALIZED');const g=x.properties.gridProperties;return "'"+n+"'!A1:"+col(Math.min(101,g.columnCount))+Math.min(10002,g.rowCount);});
  const values=Sheets.Spreadsheets.Values.batchGet(p.LEDGER_SPREADSHEET_ID,{ranges,valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
  if(values.some(v=>(v.values||[]).length>10001))throw new Error('STORAGE_LIMIT');
  const tables={};names.forEach((n,i)=>tables[n]=values[i].values||[]);
  const snapshot=KakeiboStore.decode(tables,p.LEDGER_MODE==='demo'?DemoData_.as_of:today_());
  if(snapshot.state.metadata.mode!==p.LEDGER_MODE)throw new Error('MODE_MISMATCH');
  return snapshot;
}
function response_(snapshot,p,extra){return Object.assign({ok:true,revision:snapshot.revision,state:snapshot.state,mode:p.LEDGER_MODE},extra||{});}
function readLedger(){const p=configuration_();return lock_(()=>response_(read_(p),p));}
function csvTools_(){return {hash:sha_,merchantKey:merchantKey,parseMessage:typeof parseMessage==='function'?parseMessage:null};}
function sha_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(n=>('0'+(n&255).toString(16)).slice(-2)).join('');}
function previewCsv13(input){const p=configuration_();if(JSON.stringify(input).length>400000)throw Error('CSV13_REQUEST_TOO_LARGE');return lock_(()=>{const b=read_(p);const result=KakeiboCsv13Import.plan(b.state,input,csvTools_(),new Date().toISOString());return {ok:true,revision:b.revision,report:result.report,review:KakeiboCsv13Review.preview(input.file,input.card,b.state)};});}
function previewCsvImport(files){const p=configuration_();if(JSON.stringify(files).length>500000)throw new Error('CSV_REQUEST_TOO_LARGE');return lock_(()=>{const before=read_(p);return {ok:true,revision:before.revision,report:KakeiboCsv.plan(before.state,files,csvTools_(),new Date().toISOString()).report};});}
function configuredNames_(value,code,required){
  let names;try{names=JSON.parse(value||'[]');}catch(e){throw new Error(code);}
  if(!Array.isArray(names)||(required&&!names.length)||!names.every(x=>typeof x==='string'&&x.trim()===x&&x.length>0)||new Set(names).size!==names.length)throw new Error(code);
  if(code==='MAILBOX_NOT_CONFIGURED'&&!names.every(x=>/^[a-zA-Z0-9_-]{1,80}$/.test(x)))throw new Error(code);
  return names;
}
function mailTools_(p){const tools=csvTools_();tools.allowedMailboxes=configuredNames_(p.MAILBOX_ALIASES,'MAILBOX_NOT_CONFIGURED',true);return tools;}
function previewMailImport(batch){const p=configuration_();if(JSON.stringify(batch).length>500000)throw new Error('MAIL_REQUEST_TOO_LARGE');return lock_(()=>{const b=read_(p);return {ok:true,revision:b.revision,report:KakeiboMail.plan(b.state,batch,mailTools_(p),new Date().toISOString()).report};});}
function classificationPending(){const p=configuration_();return lock_(()=>{const b=read_(p);return {ok:true,revision:b.revision,pending:KakeiboClassification.pending(b.state,sha_,new Date().toISOString())};});}
function previewClassification(file){const p=configuration_();return lock_(()=>{const b=read_(p);return {ok:true,revision:b.revision,report:KakeiboClassification.plan(b.state,file,sha_,new Date().toISOString()).report};});}
function mutateLedger(req){
  const p=configuration_();
  if(JSON.stringify(req).length>(['stageCsv13','importCsv','applyClassification','importMail','applyMailExchange'].includes(req?.command?.type)?500000:16000))throw new Error('CSV_REQUEST_TOO_LARGE');
  return lock_(()=>{
    const before=read_(p),digest='u8v1:'+sha_(JSON.stringify(req));
    const result=KakeiboCore.transact(before,req,new Date().toISOString(),before.state.as_of,digest,['importMail','applyMailExchange'].includes(req?.command?.type)?mailTools_(p):csvTools_());
    if(!result.replayed){
      const tables=KakeiboStore.encode(result.snapshot),requests=KakeiboStore.requests(tables,sheets_(p.LEDGER_SPREADSHEET_ID));
      // One atomic API call includes state, history, version, and persisted request ID.
      Sheets.Spreadsheets.batchUpdate({requests},p.LEDGER_SPREADSHEET_ID);
    }
    return response_(result.snapshot,p,{replayed:result.replayed,appliedRevision:result.appliedRevision});
  });
}
/* Run ONLY from the editor after reviewing properties and authorizing a NEW EMPTY dedicated Sheet.
 * Private underscore methods cannot be invoked by google.script.run.
 * Does not create a Spreadsheet or grant access. Never initializes over an existing ledger.
 */
function privateLedgerTarget_(p){
  // Spreadsheet sharing and web-app owner checks are independent boundaries.
  // Shared drives, missing ACL information and inherited sharing fail closed.
  try{
    const file=DriveApp.getFileById(p.LEDGER_SPREADSHEET_ID),owner=file.getOwner();
    if(!owner||owner.getEmail().toLowerCase()!==p.OWNER_EMAIL.toLowerCase()||file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw new Error('unsafe');
  }catch(e){throw new Error('LEDGER_TARGET_NOT_PRIVATE_OWNER');}
}
function initializeLedger_(){
  const p=configuration_();
  return lock_(()=>{
    privateLedgerTarget_(p);
    const existing=sheets_(p.LEDGER_SPREADSHEET_ID);
    if(existing.some(s=>KakeiboStore.NAMES.includes(s.properties.title)))throw new Error('ALREADY_INITIALIZED');
    const ranges=existing.map(s=>"'"+s.properties.title.replace(/'/g,"''")+"'");
    const contents=Sheets.Spreadsheets.Values.batchGet(p.LEDGER_SPREADSHEET_ID,{ranges,valueRenderOption:'FORMULA'});
    if(contents.valueRanges.some(x=>(x.values||[]).some(r=>r.some(v=>v!==''))))throw new Error('TARGET_NOT_EMPTY');
    const metadata={mode:p.LEDGER_MODE,categories:DemoData_.categories.slice(),accounts:configuredNames_(p.LEDGER_ACCOUNTS_JSON,'ACCOUNTS_REQUIRED',false),detail_candidates:[]};
    let state=KakeiboCore.empty(metadata,today_());
    if(p.LEDGER_MODE==='demo'){
      state.as_of=DemoData_.as_of;state.transactions=KakeiboCore.clone(DemoData_.transactions);/* Demo balances start empty: fictional fixed account names must never override the user's configured accounts. */state.assets=[];state.metadata.detail_candidates=KakeiboCore.clone(DemoData_.detail_candidates);
    }
    // Reject every corrupt seed before the first write, not on the next read.
    KakeiboCore.validate(state);
    const tables=KakeiboStore.encode({revision:0,state,requests:[]});
    const max=Math.max(0,...existing.map(s=>s.properties.sheetId));
    const created=KakeiboStore.NAMES.map((title,i)=>({properties:{sheetId:max+i+1,title,gridProperties:{rowCount:Math.max(100,tables[title].length),columnCount:Math.max(26,tables[title][0].length)}}}));
    const requests=created.map(s=>({addSheet:{properties:s.properties}})).concat(KakeiboStore.requests(tables,created));
    // Reserved future ingest tables remain empty. No Gmail/Drive import or timer here.
    ['processed','runs'].forEach((title,i)=>requests.push({addSheet:{properties:{sheetId:max+created.length+i+1,title}}}));
    Sheets.Spreadsheets.batchUpdate({requests},p.LEDGER_SPREADSHEET_ID);
    return {initialized:true,mode:p.LEDGER_MODE};
  });
}
