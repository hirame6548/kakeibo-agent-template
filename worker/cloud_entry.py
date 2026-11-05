"""Portable offline prepare/validate. Python3 + Node, standard libraries only.
No Gmail/Drive client, credentials, network access or production writes.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
from decode_mail import prepare_gmail_message, DecodeError
from source_evidence import source_records

VERSION = 'kakeibo-developer-preview-v3'
ROOT = pathlib.Path(__file__).resolve().parents[1]


def verify_bundle():
    manifest = json.loads((ROOT / 'PUBLIC-MANIFEST.json').read_text())
    if manifest['version'] != VERSION:
        raise DecodeError('bundle_version_mismatch')
    for name, expected in manifest['files'].items():
        path = ROOT / name
        if path.is_symlink() or ROOT not in path.resolve().parents:
            raise DecodeError('bundle_path_escape')
        raw = path.read_bytes()
        if len(raw) != expected['bytes'] or hashlib.sha256(raw).hexdigest() != expected['sha256']:
            raise DecodeError('bundle_file_changed:' + name)
    return manifest


def prepare_raw(value, allowed):
    if value.get('schema_version') != 1 or value.get('provenance') != 'gmail_api_raw':
        raise DecodeError('trusted_gmail_raw_required')
    messages = value.get('messages')
    if not isinstance(messages, list) or not 0 <= len(messages) <= 100:
        raise DecodeError('invalid_message_count')
    out = []
    for item in messages:
        if item.get('mailbox') not in allowed:
            raise DecodeError('mailbox_not_configured')
        raw64 = item.get('raw_base64url')
        if not isinstance(raw64, str) or len(raw64) > 2700000:
            raise DecodeError('invalid_raw_size')
        try:
            raw = base64.b64decode(raw64 + '=' * (-len(raw64) % 4), altchars=b'-_', validate=True)
        except ValueError as exc:
            raise DecodeError('invalid_base64url') from exc
        if item.get('rfc2822_sha256') and hashlib.sha256(raw).hexdigest() != item['rfc2822_sha256']:
            raise DecodeError('raw_sha256_mismatch')
        if item.get('rfc2822_bytes') is not None and len(raw) != item['rfc2822_bytes']:
            raise DecodeError('raw_size_mismatch')
        out.append(prepare_gmail_message(item['mailbox'], item['message_id'], raw))
    return {'schema_version': 1, 'messages': out}


def write_new(path, value):
    content = json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('operation', choices=['verify', 'prepare', 'validate', 'confirm'])
    ap.add_argument('--input')
    ap.add_argument('--ledger')
    ap.add_argument('--mailboxes', help='JSON array of stable aliases, supplied at runtime')
    ap.add_argument('--generated-at', help='Fixed ISO8601 UTC timestamp shared across both phases')
    ap.add_argument('--run-id')
    ap.add_argument('--classification')
    ap.add_argument('--after', help='Fresh full post-import snapshot, confirm only')
    ap.add_argument('--expected', help='Unmodified prior validate output, confirm only')
    ap.add_argument('--details')
    ap.add_argument('--sources', help='Separate trusted Gmail raw product-source records, never model output')
    ap.add_argument('--source-senders', help='JSON exact sender allowlist from reviewed runtime policy')
    ap.add_argument('--billing')
    ap.add_argument('--output')
    ap.add_argument('--exchange-output', help='validate only; new private JSON for later reviewed upload')
    args = ap.parse_args()
    manifest = verify_bundle()
    if args.operation == 'verify':
        print(json.dumps({'version': VERSION, 'verified_files': len(manifest['files'])}))
        return
    if args.operation == 'confirm':
        if not all([args.after, args.expected, args.output]):
            ap.error('confirm requires after, expected, output')
        data = {'after': json.loads(pathlib.Path(args.after).read_text()),
                'validated': json.loads(pathlib.Path(args.expected).read_text())}
        result = subprocess.run(['node', str(ROOT/'worker/confirm-run.cjs')],
                                input=json.dumps(data), text=True, capture_output=True)
        if result.returncode:
            raise DecodeError('confirmation_failed_to_execute; do not claim saved')
        value = json.loads(result.stdout)
        write_new(args.output, value)
        print(json.dumps({'operation':'confirm', **value}))
        if not value['complete']:
            raise SystemExit(2)
        return
    if not all([args.input, args.ledger, args.mailboxes, args.generated_at, args.output]):
        ap.error('input, ledger, mailboxes, generated-at, output are required')
    try:
        dt = datetime.datetime.fromisoformat(args.generated_at.replace('Z', '+00:00'))
        if dt.tzinfo is None or dt.utcoffset() != datetime.timedelta(0):
            raise ValueError()
    except ValueError:
        raise DecodeError('generated_at_must_be_utc')
    allowed = json.loads(args.mailboxes)
    if not isinstance(allowed, list) or not allowed:
        raise DecodeError('mailbox_configuration_required')
    mail_batch = prepare_raw(json.loads(pathlib.Path(args.input).read_text()), allowed)
    data = {'operation': args.operation, 'generated_at': args.generated_at, 'run_id': args.run_id,
            'allowed_mailboxes': allowed, 'mail_batch': mail_batch,
            'ledger': json.loads(pathlib.Path(args.ledger).read_text())}
    if args.sources:
        senders = json.loads(args.source_senders or '[]')
        if not isinstance(senders, list) or not senders or any(not isinstance(v,str) or '@' not in v for v in senders):
            raise DecodeError('source_sender_configuration_required')
        data['source_records'] = source_records(json.loads(pathlib.Path(args.sources).read_text()), allowed, senders)
    if args.details:
        data['details_file'] = json.loads(pathlib.Path(args.details).read_text())
    if args.classification:
        data['classification_file'] = json.loads(pathlib.Path(args.classification).read_text())
    if args.billing:
        data['billing_notices'] = json.loads(pathlib.Path(args.billing).read_text())
    result = subprocess.run(['node', str(ROOT / 'worker/cloud-run.cjs')], input=json.dumps(data),
                            text=True, capture_output=True)
    if result.returncode:
        # Do not dump process payload, source text or real transaction details.
        raise DecodeError('node_validation_failed; inspect locally, do not reconstruct input')
    value = json.loads(result.stdout)
    value['bundle_version'] = VERSION
    if args.exchange_output:
        if args.operation != 'validate' or 'exchange' not in value:
            ap.error('exchange-output requires successful validate')
        encoded = json.dumps(value['exchange'], ensure_ascii=False, separators=(',', ':')).encode()
        if len(encoded) > 500000:
            raise DecodeError('exchange_too_large')
        write_new(args.exchange_output, value['exchange'])
    write_new(args.output, value)
    print(json.dumps({'version': VERSION, 'operation': args.operation, 'mode': 'dry_run',
                      'registered': value['mail_report']['registered'], 'held': value['mail_report']['held'],
                      'blocked': value['mail_report']['blocked'],
                      'existing_financial_fields_unchanged': value['existing_financial_fields_unchanged']}))


if __name__ == '__main__':
    main()
