/* Pure commands shared by GAS and offline tests. No I/O, imports, or implicit demo seed. */
var KakeiboCore = (() => {
  'use strict';
  const FRAMES = ['food','goods','home','transport','hobby','work','medical','other'];
  const DIRECT = {'食費':'food','日用雑貨':'goods','美容・衣服':'goods','医療・保険':'medical','交通':'transport','クルマ':'transport','エンタメ':'hobby','水道・光熱':'home','住まい':'home','税金':'home'};
  const MAX = 999999999999;
  const clone = x => JSON.parse(JSON.stringify(x));
  const restoreClassification=(saved,current)=>{const out=clone(saved);if(current&&current.owner_notes)out.owner_notes=clone(current.owner_notes);if(current&&current.csv13_source_refs){for(const k of ['csv13_source_refs','amount_jpy','valuation','valuation_history'])if(Object.prototype.hasOwnProperty.call(current,k))out[k]=clone(current[k]);}if(current&&Array.isArray(current.csv_bill_ids)){for(const k of ['csv_bill_ids','csv_status','amount_jpy'])if(Object.prototype.hasOwnProperty.call(current,k))out[k]=clone(current[k]);}return out;};
  const fail = code => { throw new Error(code); };
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const frame = x => FRAMES.includes(x);
  const month = x => typeof x === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
  const amount = x => Number.isSafeInteger(x) && x >= 0 && x <= MAX;
  const frameOf = t => t.frame || DIRECT[t.category] || null;
  const purpose = t => t.status !== 'review' && !!t.category && !frameOf(t);
  const leaves = s => { const p = new Set(s.transactions.map(t=>t.parent_id).filter(Boolean)); return s.transactions.filter(t=>!p.has(t.id)); };
  const ruleOf = (s,k) => s.rules.find(r=>r.merchant_key===k) || null;
  function empty(metadata, today) {
    return {v:2, as_of:today, transactions:[], assets:[], rules:[], history:{}, settings:{bigThreshold:30000}, metadata:clone(metadata)};
  }
  function validate(s) {
    if (!s || s.v!==2 || !Array.isArray(s.transactions) || !Array.isArray(s.assets) || !Array.isArray(s.rules) || !s.history || !s.settings || !amount(s.settings.bigThreshold)) fail('CORRUPT_STATE');
    if (!s.metadata || !Array.isArray(s.metadata.categories) || !Array.isArray(s.metadata.detail_candidates)) fail('CORRUPT_METADATA');
    const ids = new Set();
    s.transactions.forEach(t=>{
      if (!t || typeof t.id!=='string' || !t.id || ids.has(t.id) || !['pending','auto','review','confirmed','provisional'].includes(t.status) || (t.frame!=null && !frame(t.frame)) || (t.amount_jpy!=null && !Number.isSafeInteger(t.amount_jpy))) fail('CORRUPT_TRANSACTION');
      ids.add(t.id);
    });
    s.transactions.forEach(t=>{if(t.parent_id && (!ids.has(t.parent_id)||t.parent_id===t.id)) fail('CORRUPT_PARENT');});
    const assetKeys=new Set();
    s.assets.forEach(a=>{const k=a.month+'|'+a.account; if(!month(a.month)||!s.metadata.accounts.includes(a.account)||!amount(a.balance)||assetKeys.has(k)) fail('CORRUPT_ASSET'); assetKeys.add(k);});
    const merchants=new Set();
    s.rules.forEach(r=>{if(!r||typeof r.merchant_key!=='string'||merchants.has(r.merchant_key)||typeof r.needs_detail!=='boolean'||(r.frame!=null&&!frame(r.frame))) fail('CORRUPT_RULE');merchants.add(r.merchant_key);});
    if(typeof KakeiboCsv!=='undefined')KakeiboCsv.validateLedger(s);
    if(typeof KakeiboCsv13Stage!=='undefined')KakeiboCsv13Stage.validate(s);
    if(typeof KakeiboMail!=='undefined')KakeiboMail.validate(s);
    return s;
  }
  function keys(o, expected) { if (!o || typeof o!=='object' || Array.isArray(o) || Object.keys(o).some(k=>!expected.includes(k))) fail('INVALID_REQUEST'); }
  function apply(before, command, now, today, csvTools) {
    validate(before);
    keys(command,['type','id','frame','candidate','ruleFuture','rulePending','month','balances','value','files','billId','purchaseId','classificationFile','text','mailBatch','sourceId','exchangeFile','csv13Input']);
    const s=clone(before), c=command;
    const tx=()=>{ const t=leaves(s).find(t=>t.id===c.id); if(!t) fail('NOT_FOUND');return t; };
    if(c.type==='applyMailExchange') {
      const p=KakeiboMailExchange.plan(s,c.exchangeFile,csvTools,now);
      if(p.report.replayed)return validate(p.state);
      s.mail_exchange_log=(s.mail_exchange_log||[]).concat([{run_id:p.report.run_id,digest:'u8v1:'+csvTools.hash(JSON.stringify(c.exchangeFile)),at:now,report:p.report}]);
      p.state.mail_exchange_log=s.mail_exchange_log;return validate(p.state);
    } else if(c.type==='importMail') {
      return validate(KakeiboMail.plan(s,c.mailBatch,csvTools,now).state);
    } else if(c.type==='resolveMailSource') {
      return validate(KakeiboMail.resolve(s,c.sourceId,c.purchaseId,now));
    } else if(c.type==='applyClassification') {
      return validate(KakeiboClassification.plan(s,c.classificationFile,csvTools.hash,now).state);
    } else if(c.type==='stageCsv13') {
      return validate(KakeiboCsv13Import.plan(s,c.csv13Input,csvTools,now).state);
    } else if(c.type==='importCsv') {
      return validate(KakeiboCsv.plan(s,c.files,csvTools,now).state);
    } else if(c.type==='resolveCsvBill') {
      return validate(KakeiboCsv.resolve(s,c.billId,c.purchaseId,csvTools,now));
    } else if(c.type==='appendOwnerNote') {
      const t=tx();if(typeof c.text!=='string'||!c.text.trim()||c.text.length>500)fail('INVALID_NOTE');
      const text=c.text.trim().replace(/\r\n?/g,'\n'),notes=t.owner_notes||[];
      if(!Array.isArray(notes)||notes.some(n=>!n||typeof n.text!=='string'||typeof n.at!=='string'))fail('CORRUPT_NOTES');
      if(notes.some(n=>n.text===text))return s;
      if(notes.length>=50)fail('NOTE_HISTORY_LIMIT');
      t.owner_notes=notes.concat([{text,at:now,source:'user'}]);
    } else if(c.type==='changeFrame') {
      const t=tx(); if(t.status==='review'||purpose(t)) fail('NOT_EDITABLE');
      const fields=['frame','frame_by','frame_rule_from','status','classified_by','updated_at'];
      const prior={};fields.forEach(k=>{if(own(t,k))prior[k]=clone(t[k]);});
      const edits=t.category_edits||[];if(edits.length>=50)fail('CATEGORY_HISTORY_LIMIT');
      edits.push({at:now,before:prior,kind:'correction'});t.category_edits=edits;
      if(c.frame==='__direct__') {if(!DIRECT[t.category]) fail('INVALID_FRAME');t.frame=null;t.frame_by=null;}
      else {if(!frame(c.frame)) fail('INVALID_FRAME');t.frame=c.frame;t.frame_by='user';}
      t.frame_rule_from=null;t.status='confirmed';t.classified_by='user';t.user_category_lock=true;t.updated_at=now;
    } else if(c.type==='undoCategory') {
      const t=tx(),edits=t.category_edits||[],last=edits[edits.length-1];
      if(!last||last.kind!=='correction')fail('NOT_UNDOABLE');
      if(edits.length>=50)fail('CATEGORY_HISTORY_LIMIT');
      const fields=['frame','frame_by','frame_rule_from','status','classified_by','updated_at'],current={};
      fields.forEach(k=>{if(own(t,k))current[k]=clone(t[k]);if(own(last.before,k))t[k]=clone(last.before[k]);else delete t[k];});
      edits.push({at:now,kind:'undo',before:current});t.updated_at=now;t.user_category_lock=true;
    } else if(c.type==='settings') {
      if(!amount(c.value)) fail('INVALID_AMOUNT');s.settings.bigThreshold=c.value;
    } else if(c.type==='balances') {
      if(!month(c.month)||c.month>today.slice(0,7)||!Array.isArray(c.balances)||c.balances.length!==s.metadata.accounts.length||c.balances.every(x=>x===null)||c.balances.some(x=>x!==null&&!amount(x))) fail('INVALID_BALANCE');
      s.metadata.accounts.forEach((acc,i)=>{s.assets=s.assets.filter(a=>!(a.month===c.month&&a.account===acc));if(c.balances[i]!==null)s.assets.push({month:c.month,account:acc,balance:c.balances[i],entered_at:now});});
      s.assets.sort((a,b)=>a.month.localeCompare(b.month)||s.metadata.accounts.indexOf(a.account)-s.metadata.accounts.indexOf(b.account));
    } else if(c.type==='confirm') {
      const t=tx(), kind=t.status==='review'?'review':purpose(t)?'purpose':null;
      if(!kind||!frame(c.frame)||typeof c.ruleFuture!=='boolean'||typeof c.rulePending!=='boolean') fail('INVALID_CONFIRMATION');
      const ambiguous=t.match_status==='ambiguous';
      if(ambiguous && c.candidate!=='__none__' && !(t.candidate_msg_ids||[]).includes(c.candidate)) fail('INVALID_CANDIDATE');
      if(ambiguous && c.candidate!=='__none__' && leaves(s).some(x=>x.id!==t.id&&x.detail_msg_id===c.candidate)) fail('DETAIL_ALREADY_USED');
      const allowRule=ambiguous ? c.candidate==='__none__' : !t.detail_msg_id;
      if((c.ruleFuture||c.rulePending)&&!allowRule) fail('DETAIL_PRECEDENCE');
      const targets=allowRule&&c.rulePending ? leaves(s).filter(x=>x.id!==t.id&&x.merchant_key===t.merchant_key&&!frameOf(x)&&(x.status==='review'||purpose(x))&&!x.detail_msg_id&&x.match_status!=='ambiguous') : [];
      const ruleBefore=ruleOf(s,t.merchant_key);
      const hist={kind,before:clone(t),ruleBefore:ruleBefore?clone(ruleBefore):null,applied:[],at:now};
      if(ambiguous) {
        t.detail_msg_id=c.candidate==='__none__'?null:c.candidate;t.match_status=t.detail_msg_id?'matched':'no_candidate';
        const detail=s.metadata.detail_candidates.find(x=>x.msg_id===t.detail_msg_id);if(detail)t.description=detail.description;
      }
      t.frame=c.frame;t.frame_by='user';t.frame_rule_from=null;
      if(kind==='review'){t.status='confirmed';t.classified_by='user';}t.updated_at=now;
      if(t.detail_msg_id||c.ruleFuture) {
        const r=ruleBefore?clone(ruleBefore):{merchant_key:t.merchant_key,frame:null,frame_from:null,needs_detail:false,detail_from:null,source:'user',hits:0};
        if(t.detail_msg_id&&!r.needs_detail){r.needs_detail=true;r.detail_from=t.id;}
        if(c.ruleFuture){r.frame=c.frame;r.frame_from=t.id;}
        r.updated_at=now;s.rules=s.rules.filter(x=>x.merchant_key!==t.merchant_key);s.rules.push(r);
      }
      targets.forEach(x=>{hist.applied.push({id:x.id,before:clone(x)});x.frame=c.frame;x.frame_by='rule';x.frame_rule_from=t.id;if(x.status==='review'){x.status='confirmed';x.classified_by='rule';}x.updated_at=now;});
      s.history[t.id]=hist;
    } else if(c.type==='reopen') {
      const hist=s.history[c.id],i=s.transactions.findIndex(t=>t.id===c.id);
      if(!hist||i<0||s.transactions[i].category_edits?.length) fail('NOT_REOPENABLE');
      s.transactions[i]=restoreClassification(hist.before,s.transactions[i]);
      hist.applied.forEach(a=>{const k=s.transactions.findIndex(t=>t.id===a.id),cur=s.transactions[k];if(k>=0&&cur.frame_by==='rule'&&cur.frame_rule_from===c.id)s.transactions[k]=restoreClassification(a.before,cur);});
      const prior=hist.ruleBefore,r=ruleOf(s,hist.before.merchant_key);
      if(r) {
        const active=from=>!!from&&from!==c.id&&!!s.history[from];
        if(r.frame_from===c.id){const keep=prior&&prior.frame&&active(prior.frame_from);r.frame=keep?prior.frame:null;r.frame_from=keep?prior.frame_from:null;}
        if(r.detail_from===c.id){const keep=prior&&prior.needs_detail&&active(prior.detail_from);r.needs_detail=!!keep;r.detail_from=keep?prior.detail_from:null;}
        if(!r.frame&&!r.needs_detail)s.rules=s.rules.filter(x=>x!==r);
      }
      Object.keys(s.history).forEach(other=>{const rb=s.history[other].ruleBefore;if(!rb||other===c.id)return;if(rb.frame_from===c.id){rb.frame=prior&&prior.frame_from!==c.id?prior.frame:null;rb.frame_from=prior?prior.frame_from:null;}if(rb.detail_from===c.id){rb.needs_detail=!!(prior&&prior.needs_detail);rb.detail_from=prior?prior.detail_from:null;}});
      delete s.history[c.id];
    } else fail('UNKNOWN_COMMAND');
    return validate(s);
  }
  // A persisted request journal shares the SAME atomic Sheets batch as the state/version.
  function transact(snapshot, req, now, today, digest, csvTools) {
    keys(req,['requestId','expectedRevision','command']);
    if(typeof req.requestId!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(req.requestId)||!Number.isSafeInteger(req.expectedRevision)||req.expectedRevision<0) fail('INVALID_REQUEST');
    const previous=snapshot.requests.find(x=>x.id===req.requestId);
    if(previous){if(/^[a-f0-9]{64}$/.test(previous.digest))fail('LEGACY_REQUEST_RECHECK');if(previous.digest!==digest)fail('REQUEST_ID_REUSED');return {snapshot,replayed:true,appliedRevision:previous.revision};}
    if(snapshot.revision!==req.expectedRevision)fail('CONFLICT');
    if(snapshot.requests.length>=10000)fail('JOURNAL_LIMIT');
    const state=apply(snapshot.state,req.command,now,today,csvTools),revision=snapshot.revision+1;
    return {snapshot:{revision,state,requests:snapshot.requests.concat([{id:req.requestId,digest,revision,at:now}])},replayed:false,appliedRevision:revision};
  }
  return {empty,validate,apply,transact,leaves,frameOf,clone};
})();
if(typeof module!=='undefined')module.exports=KakeiboCore;
