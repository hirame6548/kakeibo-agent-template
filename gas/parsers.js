// メールから利用明細を作る決定的パーサー（DESIGN.md 4章）。
// Apps Script ではファイルがグローバルスコープを共有し、Node ではテスト用に module.exports で公開する。
// どの関数も外部状態に触れない純粋関数にする。

var SENDER_CARD = 'statement@vpass.ne.jp';
var SENDER_BANK = 'smbc_service@dn.smbc.co.jp';

var SUBJECT_CARD_ALERT = 'ご利用のお知らせ【三井住友カード】';
var SUBJECT_CARD_BATCH = 'ご利用明細のお知らせ【三井住友カード】';
var SUBJECT_BANK_WITHDRAWAL = '【三井住友銀行】口座出金のお知らせ';

// 通知の「ご利用カード」の表記（NFKC正規化後）→ 台帳の card 値
var CARD_NAMES = {
  'Olive/クレジット': 'olive',
  'Amazonマスター': 'amazon_master'
};

// MVPで支出として記録する銀行出金の「内容」（DESIGN.md 4章）
var RECORDED_BANK_CONTENTS = ['PAYPAY'];

/**
 * Gmailのメール1通を読み、利用明細の配列にする。
 * @param {{id: string, from: string, subject: string, body: string}} msg
 * @return {{kind: string, transactions: Object[], error: (string|null)}}
 *   kind: card_alert / card_batch / bank / ignored
 *   読み取れない場合は transactions を空にして error に理由を入れる（部分的な結果は返さない）
 */
function parseMessage(msg) {
  var from = String(msg.from || '').toLowerCase();
  var subject = String(msg.subject || '').trim();
  var body = normalizeText_(msg.body);

  if (from.indexOf(SENDER_CARD) !== -1 && subject === SUBJECT_CARD_ALERT) {
    return wrap_('card_alert', msg.id, function () { return parseCardBlocks_(body, true, 'card_alert'); });
  }
  if (from.indexOf(SENDER_CARD) !== -1 && subject === SUBJECT_CARD_BATCH) {
    return wrap_('card_batch', msg.id, function () { return parseCardBlocks_(body, false, 'card_batch'); });
  }
  if (from.indexOf(SENDER_BANK) !== -1 && subject === SUBJECT_BANK_WITHDRAWAL) {
    return wrap_('bank', msg.id, function () { return parseBankWithdrawal_(body); });
  }
  return { kind: 'ignored', transactions: [], error: null };
}

/**
 * 利用先の表記をルール照合用のキーにする（DESIGN.md 4章）。
 * 全角→半角、大文字化、空白の統一、末尾の決済手段表記の除去。
 */
function merchantKey(raw) {
  var s = String(raw || '').normalize('NFKC').toUpperCase();
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\/\s*(NFC|ID)$/, '');
  return s;
}

function wrap_(kind, msgId, parse) {
  var records;
  try {
    records = parse();
  } catch (e) {
    return { kind: kind, transactions: [], error: e.message };
  }
  var transactions = records.map(function (r, i) {
    r.id = msgId + '#' + (i + 1);
    r.merchant_key = merchantKey(r.merchant_raw);
    return r;
  });
  return { kind: kind, transactions: transactions, error: null };
}

function normalizeText_(text) {
  return String(text || '').replace(/\r\n?/g, '\n').normalize('NFKC');
}

// カード通知の本文から「◇利用日」で始まるブロックを順に読む。
// リアルタイム通知は1通1件で時刻付き、後日まとめ通知は最大30件で日付のみ。
function parseCardBlocks_(body, expectTime, source) {
  var lines = body.split('\n').map(function (l) { return l.trim(); });
  var card = null;
  var cardRaw = null;
  var records = [];
  var current = null;

  function finish() {
    if (!current) return;
    records.push(buildCardRecord_(current, card, cardRaw, expectTime, source));
    current = null;
  }

  lines.forEach(function (line) {
    var m = line.match(/^ご利用カード:(.+)$/);
    if (m) {
      finish();
      cardRaw = m[1].trim();
      card = CARD_NAMES[cardRaw] || null;
      return;
    }
    m = line.match(/^◇(利用日|利用先|利用取引|利用金額):(.*)$/);
    if (!m) return;
    if (m[1] === '利用日') {
      finish();
      current = {};
    }
    if (!current) throw new Error('「◇利用日」より前に「◇' + m[1] + '」がある');
    current[m[1]] = m[2].trim();
  });
  finish();

  if (records.length === 0) throw new Error('利用内容のブロックが見つからない');
  if (expectTime && records.length !== 1) throw new Error('リアルタイム通知に複数の利用がある: ' + records.length);
  return records;
}

function buildCardRecord_(block, card, cardRaw, expectTime, source) {
  ['利用日', '利用先', '利用金額'].forEach(function (key) {
    if (!block[key]) throw new Error('「◇' + key + '」が空');
  });
  if (!cardRaw) throw new Error('「ご利用カード」が見つからない');

  var usedAt = parseCardDate_(block['利用日'], expectTime);
  var amount = parseAmount_(block['利用金額']);
  var type = block['利用取引'] || '';

  return {
    source: source,
    card: card,
    card_raw: cardRaw,
    used_at: usedAt,
    merchant_raw: block['利用先'],
    transaction_type: type,
    amount_jpy: amount.jpy,
    amount_foreign: amount.foreign,
    currency: amount.currency,
    // 「買物」以外（返品・取消など）とカード名の未知は、実例を見るまで要確認にする
    needs_review: type !== '買物' || card === null
  };
}

// "2026/10/22 22:13" または "2026/10/21" → "2026-10-22T22:13" / "2026-10-21"
function parseCardDate_(text, expectTime) {
  var m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) throw new Error('利用日を読めない: ' + text);
  var date = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  if (m[4] === undefined) {
    if (expectTime) throw new Error('リアルタイム通知の利用日に時刻がない: ' + text);
    return date;
  }
  return date + 'T' + pad2_(m[4]) + ':' + m[5];
}

// "4,260円" → 円。"22.00USD" → 外貨。"21,640.00JPY" → 円（外貨表記でも通貨がJPYなら円額）。
// 実メールの本文は数字と通貨の間に空白がない（スニペット表示では空白が入る）ので、どちらも受け付ける
function parseAmount_(text) {
  var s = text.replace(/\s+/g, ' ').trim();
  var m = s.match(/^(-?[\d,]+)円$/);
  if (m) return { jpy: toInt_(m[1]), foreign: null, currency: null };
  m = s.match(/^(-?[\d,]+(?:\.\d+)?) ?([A-Z]{3})$/);
  if (m) {
    var value = Number(m[1].replace(/,/g, ''));
    if (m[2] === 'JPY') {
      if (value !== Math.round(value)) throw new Error('円額に小数がある: ' + text);
      return { jpy: value, foreign: null, currency: null };
    }
    return { jpy: null, foreign: value, currency: m[2] };
  }
  throw new Error('利用金額を読めない: ' + text);
}

function parseBankWithdrawal_(body) {
  var date = matchLine_(body, /^出金日\s*:\s*(\d{4})年(\d{1,2})月(\d{1,2})日$/m, '出金日');
  var amount = matchLine_(body, /^出金額\s*:\s*(-?[\d,]+)円$/m, '出金額');
  var content = matchLine_(body, /^内容\s*:\s*(.+)$/m, '内容');
  var contentText = content[1].trim();

  if (RECORDED_BANK_CONTENTS.indexOf(contentText.toUpperCase()) === -1) return [];

  return [{
    source: 'bank',
    card: null,
    card_raw: null,
    used_at: date[1] + '-' + pad2_(date[2]) + '-' + pad2_(date[3]),
    merchant_raw: contentText,
    transaction_type: '出金',
    amount_jpy: toInt_(amount[1]),
    amount_foreign: null,
    currency: null,
    needs_review: false
  }];
}

function matchLine_(body, re, label) {
  var m = body.match(re);
  if (!m) throw new Error('「' + label + '」を読めない');
  return m;
}

function toInt_(text) {
  return parseInt(text.replace(/,/g, ''), 10);
}

function pad2_(n) {
  return ('0' + n).slice(-2);
}

if (typeof module !== 'undefined') {
  module.exports = { parseMessage: parseMessage, merchantKey: merchantKey };
}
