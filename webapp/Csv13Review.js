/* Read-only reconciliation proposals. No financial values or ledger rows are mutated. */
var KakeiboCsv13Review=(()=>{
  'use strict';
  const norm=s=>String(s||'').normalize('NFKC').replace(/−/g,'-').replace(/\s+/g,'').toUpperCase();
  function preview(file,card,state){
    if(file?.profile!=='smbc-13-observed-v1'||!['olive','amazon_master'].includes(card)||!Array.isArray(state?.transactions))throw Error('CSV13_REVIEW_INVALID_INPUT');
    const parents=new Set(state.transactions.map(t=>t.parent_id).filter(Boolean));
    const tx=state.transactions.filter(t=>t.card===card&&!parents.has(t.id));
    const rows=file.rows.map(r=>{
      const foreign=!!r.currency_raw&&r.currency_raw!=='JPY';
      // Column7 denomination is not yet verified: comparison is a proposal only.
      const sameAmount=t=>foreign?t.currency===r.currency_raw&&t.amount_foreign===Number(r.foreign_amount_raw):t.amount_jpy===r.usage_amount_reported;
      const exact=tx.filter(t=>t.used_at.slice(0,10)===r.used_at&&sameAmount(t)&&norm(t.merchant_raw)===norm(r.merchant_raw));
      const day=tx.filter(t=>t.used_at.slice(0,10)===r.used_at&&sameAmount(t));
      const nearby=tx.filter(t=>sameAmount(t)&&Math.abs(Date.parse(t.used_at.slice(0,10))-Date.parse(r.used_at))<=3*86400000);
      const candidates=exact.length?exact:day.length?day:nearby;
      return {row_number:r.row_number,status:exact.length?'strict_candidate':day.length?'merchant_review':nearby.length?'date_review':'csv_only_review',candidate_purchase_ids:candidates.map(t=>t.id),source:{...r},financial_update_allowed:false};
    });
    // Enforce one-to-one globally. Equal rows are a group, never arbitrary ordinal pairing.
    const uses=new Map();for(const r of rows)for(const id of r.candidate_purchase_ids)uses.set(id,(uses.get(id)||0)+1);
    for(const r of rows)if(r.status==='strict_candidate')r.status=r.candidate_purchase_ids.length===1&&uses.get(r.candidate_purchase_ids[0])===1?'unique_strict_proposal':'group_review';
    const seen=new Set(rows.flatMap(r=>r.candidate_purchase_ids));
    return {mode:'preview_only',persistence_ready:false,card,billing_month:file.billing_month,rows,unmatched_transaction_ids:tx.filter(t=>!seen.has(t.id)).map(t=>t.id),summary:{...file.summary,row_count:rows.length,unique_strict_proposals:rows.filter(r=>r.status==='unique_strict_proposal').length,review_rows:rows.filter(r=>r.status!=='unique_strict_proposal').length}};
  }
  return {preview};
})();
if(typeof module!=='undefined')module.exports=KakeiboCsv13Review;
