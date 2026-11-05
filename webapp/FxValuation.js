/* Pure USD reference valuation. No network, transaction mutation or bill writes. */
var KakeiboFxValuation=(()=>{
 'use strict';
 const fail=c=>{throw Error('FX_'+c);};
 const date=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))fail('DATE');const d=new Date(s+'T00:00:00Z');if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==s)fail('DATE');return s;};
 function decimal(s,signed){if(typeof s!=='string'||!(signed?/^-?\d{1,12}(?:\.\d{1,8})?$/:/^\d{1,12}(?:\.\d{1,8})?$/).test(s))fail('DECIMAL');const negative=s.startsWith('-'),parts=s.replace(/^-/,'').split('.'),scale=10n**BigInt((parts[1]||'').length);return {n:BigInt(parts.join(''))*(negative?-1n:1n),scale};}
 function estimate(input){
  if(input.currency!=='USD'||!Array.isArray(input.rates)||input.source!=='https://www.stat-search.boj.or.jp/api/v1/getDataCode'||input.series!=='FM08/FXERD04'||typeof input.fetched_at!=='string'||!Number.isFinite(Date.parse(input.fetched_at)))fail('SOURCE');
  const used=date(input.used_date),eligible=input.rates.filter(r=>date(r.date)<=used&&r.rate!==null);if(!eligible.length)return {status:'unavailable',amount_jpy:null};
  const sorted=eligible.slice().sort((a,b)=>b.date.localeCompare(a.date));if(new Set(eligible.map(r=>r.date)).size!==eligible.length)fail('DUPLICATE_RATE');
  const selected=sorted[0],amount=decimal(input.amount_foreign_raw,true),rate=decimal(selected.rate,false);if(rate.n<=0n)fail('RATE');
  const product=amount.n*rate.n,den=amount.scale*rate.scale,sign=product<0n?-1n:1n,abs=product*sign;
  const rounded=((abs+den/2n)/den)*sign,jpy=Number(rounded);if(!Number.isSafeInteger(jpy)||Math.abs(jpy)>999999999999)fail('OVERFLOW');
  return {status:'estimated',amount_jpy:jpy,currency:'USD',amount_foreign_raw:input.amount_foreign_raw,used_date:used,rate_raw:selected.rate,rate_date:selected.date,source:input.source,series:input.series,fetched_at:input.fetched_at,estimated:true,label:'利用日の参考レートによる概算'};
 }
 function replaceWithCard(prior,card){if(!Number.isSafeInteger(card.amount_jpy)||Math.abs(card.amount_jpy)>999999999999||typeof card.source_ref!=='string'||!card.source_ref||card.same_purchase_verified!==true)fail('CARD_EVIDENCE');return {status:'card_reported',amount_jpy:card.amount_jpy,estimated:false,source_ref:card.source_ref,previous:JSON.parse(JSON.stringify(prior)),billing_finality:'not_asserted'};}
 return {estimate,replaceWithCard};
})();
if(typeof module!=='undefined')module.exports=KakeiboFxValuation;
