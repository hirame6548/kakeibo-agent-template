/* Analysis-only 13-column statement adapter. No persistence or RPC integration.
 * Unverified column semantics remain raw; blank billing amounts are never zero.
 */
var KakeiboCsv13=(()=>{
  'use strict';
  const PROFILE='smbc-13-observed-v1';
  const fail=c=>{throw Error('CSV13_'+c);};
  function integer(s){if(!/^-?\d+$/.test(s))fail('INVALID_AMOUNT');const n=Number(s);if(!Number.isSafeInteger(n)||Math.abs(n)>999999999999)fail('INVALID_AMOUNT');return n;}
  function date(s){const m=/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);if(!m)fail('INVALID_DATE');const [y,mo,d]=m.slice(1).map(Number),v=new Date(Date.UTC(y,mo-1,d));if(y<2000||v.getUTCFullYear()!==y||v.getUTCMonth()!==mo-1||v.getUTCDate()!==d)fail('INVALID_DATE');return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
  function parse(text,tokenize){if(typeof tokenize!=='function')fail('MISSING_TOKENIZER');const records=tokenize(text);let start=0;if(records[0]?.length===3&&!/^\d{4}\//.test(records[0][0]))start=1;
    const rows=[];let billingMonth=null;
    for(let i=start;i<records.length;i++){const r=records[i];if(r.every(v=>v===''))continue;if(r.length!==13)fail('UNSUPPORTED_COLUMNS');
      const used=date(r[0]);if(!r[1].trim()||r[1].length>512)fail('INVALID_MERCHANT');
      // Reject dependent/unknown identity roles rather than persist their contents.
      if(r[2]!=='ご本人')fail('UNSUPPORTED_OWNER_ROLE');
      if(r[3]!=='1回払い'||r[4]!==''||r[8]!=='')fail('UNSUPPORTED_PAYMENT_FIELDS');
      const m=/^'(\d{2})\/(0[1-9]|1[0-2])$/.exec(r[5]);if(!m)fail('INVALID_BILLING_MONTH');const bm='20'+m[1]+'-'+m[2];if(billingMonth&&billingMonth!==bm)fail('MIXED_BILLING_MONTH');billingMonth=bm;
      const foreign=r.slice(9);if(foreign.some(Boolean)&&(!/^\d+(?:\.\d+)?$/.test(r[9])||!/^[A-Z]{3}$/.test(r[10])||!/^\d+(?:\.\d+)?$/.test(r[11])||! /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/.test(r[12])))fail('INVALID_FOREIGN_FIELDS');
      rows.push({row_number:i+1,used_at:used,merchant_raw:r[1],billing_month:bm,payment_method_raw:r[3],column5_raw:r[4],usage_amount_reported:integer(r[6]),billed_jpy:r[7]===''?null:integer(r[7]),billing_amount_status:r[7]===''?'not_listed':'listed',column9_raw:r[8],foreign_amount_raw:r[9]||null,currency_raw:r[10]||null,exchange_rate_raw:r[11]||null,column13_raw:r[12]||null});
    }
    if(!rows.length||rows.length>1000)fail('INVALID_ROW_COUNT');const known=rows.reduce((n,r)=>n+(r.billed_jpy===null?0:r.billed_jpy),0),missing=rows.filter(r=>r.billed_jpy===null).length;if(!Number.isSafeInteger(known))fail('TOTAL_OVERFLOW');
    return {profile:PROFILE,billing_month:billingMonth,rows,summary:{known_billed_total:known,missing_billed_count:missing,billed_total:missing?null:known},persistence_ready:false};
  }
  return {PROFILE,parse};
})();
if(typeof module!=='undefined')module.exports=KakeiboCsv13;
