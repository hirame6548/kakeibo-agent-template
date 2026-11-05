"""Synthetic fixtures generated in private temp dirs; no real mail or ledger embedded."""
import base64
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
ENTRY = ROOT / 'worker' / 'cloud_entry.py'


def raw(subject, body):
    encoded_subject = base64.b64encode(subject.encode('iso-2022-jp')).decode()
    headers = ('Received: from synthetic.example.invalid by mx.google.com with ESMTPS id test\r\n'
               'Received-SPF: pass (google.com: synthetic sender)\r\n'
               'Authentication-Results: mx.google.com; dkim=pass header.i=@vpass.ne.jp; '
               'spf=pass; dmarc=pass header.from=vpass.ne.jp\r\n'
               'From: statement@vpass.ne.jp\r\n'
               f'Subject: =?iso-2022-jp?B?{encoded_subject}?=\r\n'
               'MIME-Version: 1.0\r\n'
               'Content-Type: text/plain; charset=iso-2022-jp\r\n'
               'Content-Transfer-Encoding: base64\r\n\r\n')
    return headers.encode() + base64.b64encode(body.encode('iso-2022-jp'))


def main():
    subprocess.run([sys.executable, str(ENTRY), 'verify'], check=True)
    body = '架空宛名 様\nご利用カード：Ｏｌｉｖｅ／クレジット\n◇利用日：2098/10/25 11:11\n◇利用先：架空商店\n◇利用取引：買物\n◇利用金額：123円'
    messages = [('deadbeef0001', 'ご利用のお知らせ【三井住友カード】', body),
                ('deadbeef0002', 'ご利用明細のお知らせ【三井住友カード】', body.replace(' 11:11', '').replace('123円', '22.00USD')),
                ('deadbeef0003', 'ご利用確認のお願い【三井住友カード】', body+'\n決済未完了')]
    inputs = {'schema_version': 1, 'provenance': 'gmail_api_raw', 'messages': [
        {'mailbox': 'mailbox-A', 'message_id': mid, 'raw_base64url': base64.urlsafe_b64encode(raw(subject, text)).decode()}
        for mid, subject, text in messages]}
    ledger = {'revision': 7, 'requests': [], 'state': {'v': 2, 'as_of': '2098-10-25',
        'transactions': [{'id': 'synthetic-old', 'source': 'csv', 'used_at': '2098-09-01',
            'card': 'olive', 'merchant_raw': '架空過去店', 'amount_jpy': 500, 'category': '生活用品',
            'status': 'confirmed', 'parent_id': None, 'user_category_lock': True,
            'owner_notes': [{'text': '架空本人メモ', 'at': '2098-09-02T00:00:00Z', 'source': 'user'}]}],
        'assets': [], 'rules': [], 'history': {}, 'settings': {'bigThreshold': 30000},
        'metadata': {'categories': [], 'accounts': [], 'detail_candidates': []}}}
    with tempfile.TemporaryDirectory(prefix='mail-worker-selftest-') as tmp:
        directory = pathlib.Path(tmp)
        input_path, ledger_path = directory/'raw.json', directory/'ledger.json'
        input_path.write_text(json.dumps(inputs)); ledger_path.write_text(json.dumps(ledger))
        common = ['--input', str(input_path), '--ledger', str(ledger_path), '--mailboxes', '["mailbox-A"]',
                  '--generated-at', '2098-10-25T12:00:00Z']
        subprocess.run([sys.executable, str(ENTRY), 'prepare', *common, '--output', str(directory/'prepared.json')], check=True)
        prepared = json.loads((directory/'prepared.json').read_text())
        assert prepared['mail_report']['registered'] == 2 and prepared['mail_report']['blocked'] == 1
        assert prepared['existing_transactions_unchanged']
        assert '架空宛名' not in (directory/'prepared.json').read_text()
        assert any(item['amount_jpy'] is None and item['currency'] == 'USD' for item in prepared['pending']['items'])
        classification = {'schema_version': 1, 'classification_mode': 'provisional', 'run_id': 'synthetic-classification-0001',
                          'results': [{'id': i['id'], 'input_version': i['input_version'], 'match_status': 'no_candidate',
                              'detail_msg_id': None, 'candidate_msg_ids': [], 'category': 'その他',
                              'description': '購入内容不明', 'evidence': '合成試験の暫定用途', 'confidence': 0.1,
                              'items': [], 'rule_suggestion': None} for i in prepared['pending']['items']]}
        (directory/'class.json').write_text(json.dumps(classification))
        subprocess.run([sys.executable, str(ENTRY), 'validate', *common, '--run-id', 'synthetic-exchange-0001',
                        '--classification', str(directory/'class.json'), '--output', str(directory/'validated.json'),
                        '--exchange-output', str(directory/'exchange-synthetic-exchange-0001.json')], check=True)
        validated = json.loads((directory/'validated.json').read_text())
        assert validated['exchange_report']['classification']['provisional'] == 2
        assert validated['existing_financial_fields_unchanged']
        assert (directory/'validated.json').stat().st_mode & 0o777 == 0o600
        # Fail receiver authentication before any output creation.
        bad = json.loads(json.dumps(inputs)); decoded = base64.urlsafe_b64decode(bad['messages'][0]['raw_base64url'])
        bad['messages'][0]['raw_base64url'] = base64.urlsafe_b64encode(decoded.replace(b'dmarc=pass', b'dmarc=fail')).decode()
        (directory/'bad.json').write_text(json.dumps(bad))
        result = subprocess.run([sys.executable, str(ENTRY), 'prepare', '--input', str(directory/'bad.json'),
            '--ledger', str(ledger_path), '--mailboxes', '["mailbox-A"]', '--generated-at', '2098-10-25T12:00:00Z',
            '--output', str(directory/'bad-output.json')], capture_output=True)
        assert result.returncode != 0 and not (directory/'bad-output.json').exists()
    subprocess.run(['node', str(ROOT/'safetytest.cjs')], check=True)
    subprocess.run([sys.executable, str(ROOT/'source_selftest.py')], check=True)
    subprocess.run(['node', str(ROOT/'lifecycle_selftest.cjs')], check=True)
    subprocess.run(['node', str(ROOT/'confirm_regression_selftest.cjs')], check=True)
    print('PASS: verify + ISO2022/auth + JPY/USD/blocked + frozen versions/classification + owner protection + auth-fail; no network/persistence')


if __name__ == '__main__':
    main()
