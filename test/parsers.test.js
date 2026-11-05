// パーサーのテスト。メール本文はすべて架空の値で作る（実メールをリポジトリに入れない）。
// 実行: node --test Project_Kakeibo/test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage, merchantKey } = require('../gas/parsers.js');

const CARD = 'statement@vpass.ne.jp';
const BANK = 'SMBC_service@dn.smbc.co.jp';

function alertBody({ card = 'Ｏｌｉｖｅ／クレジット', date = '2026/01/02 12:34', merchant = 'テスト商店', type = '買物', amount = '1,234円' } = {}) {
  return [
    'テスト　様', '',
    'いつも三井住友カードをご利用頂きありがとうございます。',
    'お客様のカードご利用内容をお知らせいたします。', '',
    `ご利用カード：${card}`, '',
    `◇利用日：${date}`, `◇利用先：${merchant}`, `◇利用取引：${type}`, `◇利用金額：${amount}`, '',
    '※携帯電話や公共料金などの継続的なご利用（注） 及び ETCやPiTaPa等、一部の電子マネー利用については通知されません。'
  ].join('\r\n');
}

function alert(opts) {
  return parseMessage({ id: 'm1', from: `"三井住友カード" <${CARD}>`, subject: 'ご利用のお知らせ【三井住友カード】', body: alertBody(opts) });
}

test('リアルタイム通知を1件の明細にする', () => {
  const r = alert();
  assert.equal(r.kind, 'card_alert');
  assert.equal(r.error, null);
  assert.deepEqual(r.transactions, [{
    id: 'm1#1', source: 'card_alert', card: 'olive', card_raw: 'Olive/クレジット',
    used_at: '2026-01-02T12:34', merchant_raw: 'テスト商店', merchant_key: 'テスト商店',
    transaction_type: '買物', amount_jpy: 1234, amount_foreign: null, currency: null, needs_review: false
  }]);
});

test('Amazonマスターのカード名を読む', () => {
  assert.equal(alert({ card: 'Ａｍａｚｏｎマスター' }).transactions[0].card, 'amazon_master');
});

test('未知のカード名は要確認にする', () => {
  const t = alert({ card: 'テストカード' }).transactions[0];
  assert.equal(t.card, null);
  assert.equal(t.card_raw, 'テストカード');
  assert.equal(t.needs_review, true);
});

test('外貨は外貨額と通貨に入れ、円額は空にする', () => {
  const t = alert({ amount: '12.50USD' }).transactions[0];
  assert.equal(t.amount_jpy, null);
  assert.equal(t.amount_foreign, 12.5);
  assert.equal(t.currency, 'USD');
});

test('外貨表記でも通貨がJPYなら円額にする', () => {
  const t = alert({ amount: '9,800.00JPY' }).transactions[0];
  assert.equal(t.amount_jpy, 9800);
  assert.equal(t.currency, null);
});

test('数字と通貨の間に空白があっても読む', () => {
  assert.equal(alert({ amount: '12.50 USD' }).transactions[0].amount_foreign, 12.5);
});

test('買物以外の利用取引は要確認にする', () => {
  assert.equal(alert({ type: '取消' }).transactions[0].needs_review, true);
});

test('リアルタイム通知に時刻がなければ読み取りエラー', () => {
  const r = alert({ date: '2026/01/02' });
  assert.deepEqual(r.transactions, []);
  assert.match(r.error, /時刻がない/);
});

test('金額が読めなければ部分的な結果を返さない', () => {
  const r = alert({ amount: '不明' });
  assert.deepEqual(r.transactions, []);
  assert.match(r.error, /利用金額を読めない/);
});

test('後日まとめ通知の複数ブロックを順に読む', () => {
  const body = [
    'テスト　様', '',
    'ご利用カード：Ｏｌｉｖｅ／クレジット', '',
    '◇利用日：2026/01/03', '◇利用先：テスト自販機／ｉＤ', '◇利用取引：買物', '◇利用金額：150円', '',
    '◇利用日：2026/01/04', '◇利用先：テスト書店', '◇利用取引：買物', '◇利用金額：2,000円', ''
  ].join('\n');
  const r = parseMessage({ id: 'm2', from: CARD, subject: 'ご利用明細のお知らせ【三井住友カード】', body });
  assert.equal(r.kind, 'card_batch');
  assert.equal(r.error, null);
  assert.deepEqual(r.transactions.map(t => [t.id, t.used_at, t.merchant_key, t.amount_jpy]), [
    ['m2#1', '2026-01-03', 'テスト自販機', 150],
    ['m2#2', '2026-01-04', 'テスト書店', 2000]
  ]);
});

test('同じ店・同じ金額の通知も別々の明細のまま残す', () => {
  const block = ['◇利用日：2026/01/05', '◇利用先：テストランドリー', '◇利用取引：買物', '◇利用金額：200円'];
  const body = ['ご利用カード：Ｏｌｉｖｅ／クレジット', ...block, ...block].join('\n');
  const r = parseMessage({ id: 'm3', from: CARD, subject: 'ご利用明細のお知らせ【三井住友カード】', body });
  assert.deepEqual(r.transactions.map(t => t.id), ['m3#1', 'm3#2']);
});

function bankBody(content, amount = '1,000円') {
  return ['テスト　さま', '', '三井住友銀行より、口座引落しについてお知らせします。', '',
    '出金日　：　2026年01月06日', `出金額　：　${amount}`, `内容　　：　${content}`].join('\n');
}

test('銀行出金のうちPAYPAYは支出にする', () => {
  const r = parseMessage({ id: 'b1', from: BANK, subject: '【三井住友銀行】口座出金のお知らせ', body: bankBody('PAYPAY') });
  assert.equal(r.kind, 'bank');
  assert.deepEqual(r.transactions.map(t => [t.id, t.used_at, t.merchant_raw, t.amount_jpy, t.card]), [
    ['b1#1', '2026-01-06', 'PAYPAY', 1000, null]
  ]);
});

test('PAYPAY以外の銀行出金は記録しない', () => {
  const r = parseMessage({ id: 'b2', from: BANK, subject: '【三井住友銀行】口座出金のお知らせ', body: bankBody('テストカード') });
  assert.equal(r.kind, 'bank');
  assert.equal(r.error, null);
  assert.deepEqual(r.transactions, []);
});

test('対象外のメールは読み飛ばす', () => {
  assert.equal(parseMessage({ id: 'x', from: CARD, subject: 'お支払い金額のお知らせ', body: '' }).kind, 'ignored');
  assert.equal(parseMessage({ id: 'y', from: 'someone@example.com', subject: 'ご利用のお知らせ【三井住友カード】', body: alertBody() }).kind, 'ignored');
});

test('merchantKeyは全角・決済手段表記・空白の違いを吸収する', () => {
  assert.equal(merchantKey('テスト店／ＮＦＣ'), 'テスト店');
  assert.equal(merchantKey('ｔｅｓｔ　ｓｈｏｐ  ｉｂ'), 'TEST SHOP IB');
  assert.equal(merchantKey('テスト自販機／ｉＤ'), 'テスト自販機');
  assert.equal(merchantKey('セブン－イレブン'), 'セブン-イレブン');
});
