"""Strict, local RFC2822 text decoder. No network, credentials or persisted messages.

Receiver authentication must be supplied independently by the trusted Gmail fetcher;
this decoder deliberately does not trust Authentication-Results in arbitrary input.
"""
from email import policy
from email.parser import BytesParser
from email.header import decode_header


class DecodeError(ValueError):
    pass


def _header(value):
    try:
        return ''.join(part.decode(charset or 'ascii', errors='strict')
                       if isinstance(part, bytes) else part
                       for part, charset in decode_header(value or ''))
    except (UnicodeError, LookupError) as exc:
        raise DecodeError('invalid_header_encoding') from exc


def decode_rfc2822(raw):
    if not isinstance(raw, bytes) or len(raw) > 2_000_000:
        raise DecodeError('invalid_raw_size')
    msg = BytesParser(policy=policy.compat32).parsebytes(raw)
    if any(len(msg.get_all(k, [])) != 1 for k in ['From', 'Subject']):
        raise DecodeError('ambiguous_headers')
    parts = list(msg.walk())
    if any(p.defects for p in parts):
        raise DecodeError('malformed_mime')
    text = [p for p in parts if p.get_content_type() == 'text/plain'
            and p.get_content_disposition() != 'attachment']
    if len(text) != 1:
        raise DecodeError('ambiguous_or_missing_plaintext')
    part = text[0]
    charset = part.get_content_charset() or 'us-ascii'
    try:
        payload = part.get_payload(decode=True)
        if part.defects or not isinstance(payload, bytes):
            raise DecodeError('invalid_transfer_encoding')
        body = payload.decode(charset, errors='strict')
    except (UnicodeError, LookupError) as exc:
        raise DecodeError('invalid_body_encoding') from exc
    if len(body) > 200_000 or any(c in body for c in ['\ufffd', '\x00', '\x1b']):
        raise DecodeError('lossy_or_control_text')
    return {'from': _header(msg['From']), 'subject': _header(msg['Subject']),
            'body': body, 'decoding': {'source': 'raw_mime', 'charset': charset,
                                      'status': 'ok'}}


def gmail_receiver_authentication(raw):
    """Derive attestation ONLY for raw bytes fetched from the trusted Gmail API.

    This validates the receiver header boundary, not a cryptographic DKIM signature.
    Passing an arbitrary .eml to this function cannot establish Gmail provenance.
    """
    import hashlib
    import re
    from email.utils import getaddresses
    msg = BytesParser(policy=policy.compat32).parsebytes(raw)
    headers = list(msg.raw_items())
    auths = [(i, str(v)) for i, (k, v) in enumerate(headers)
             if k.lower() == 'authentication-results']
    if len(auths) != 1:
        raise DecodeError('receiver_auth_missing_or_duplicate')
    ai, value = auths[0]
    unfolded = re.sub(r'\r?\n[ \t]+', ' ', value).strip()
    fields = unfolded.split(';')
    if fields[0].strip().lower() != 'mx.google.com':
        raise DecodeError('untrusted_authserv_id')
    from_headers = [(i, v) for i, (k, v) in enumerate(headers) if k.lower() == 'from']
    addresses = getaddresses([_header(v) for _, v in from_headers])
    if len(from_headers) != 1 or len(addresses) != 1 or addresses[0][1].lower() != 'statement@vpass.ne.jp':
        raise DecodeError('sender_mismatch')
    received = [i for i, (k, v) in enumerate(headers) if k.lower() == 'received'
                and re.search(r'\bby\s+mx\.google\.com\b', str(v), re.I)]
    if len(received) != 1 or not received[0] < ai < from_headers[0][0]:
        raise DecodeError('receiver_header_boundary')
    for mechanism in ['dkim', 'spf', 'dmarc']:
        matches = [f.strip() for f in fields[1:]
                   if re.match(r'^\s*' + mechanism + r'\s*=', f, re.I)]
        if len(matches) != 1 or not re.match(r'^' + mechanism + r'=pass(?:\s|$)', matches[0], re.I):
            raise DecodeError('receiver_auth_not_pass')
        if mechanism == 'dkim' and not re.search(r'(?:^|\s)header\.i=(?:[^\s@;]+)?@vpass\.ne\.jp(?:\s|$)', matches[0], re.I):
            raise DecodeError('dkim_alignment')
        if mechanism == 'dmarc' and not re.search(r'(?:^|\s)header\.from=vpass\.ne\.jp(?:\s|$)', matches[0], re.I):
            raise DecodeError('dmarc_alignment')
    spfs = [(i, str(v)) for i, (k, v) in enumerate(headers) if k.lower() == 'received-spf']
    if len(spfs) != 1 or not received[0] < spfs[0][0] < from_headers[0][0] or not re.match(r'^pass(?:\s|$)', spfs[0][1], re.I):
        raise DecodeError('received_spf_boundary')
    return {'receiver': 'gmail', 'from': 'statement@vpass.ne.jp', 'dmarc': 'pass',
            'aligned': True, 'verification_method': 'gmail_raw_headers_v1',
            'raw_sha256': hashlib.sha256(raw).hexdigest()}


def prepare_gmail_message(mailbox, message_id, raw):
    """Select financial lines locally; exclude addressee, footer and full mail body."""
    import unicodedata
    decoded = decode_rfc2822(raw)
    auth = gmail_receiver_authentication(raw)
    lines = []
    for line in unicodedata.normalize('NFKC', decoded['body']).splitlines():
        line = line.strip()
        if line.startswith('ご利用カード:'):
            card = line.split(':', 1)[1].strip()
            lines.append('ご利用カード:' + (card if card in ['Olive/クレジット', 'Amazonマスター'] else '不明カード'))
        elif line.startswith(('◇利用日:', '◇利用先:', '◇利用取引:', '◇利用金額:')):
            lines.append(line)
        elif any(word in line for word in ['決済未完了', '利用不可', 'ご利用を制限', 'ご利用いただけません', '利用できません']):
            lines.append('利用不可')
    return {'mailbox': mailbox, 'message_id': message_id, 'from': auth['from'],
            'subject': decoded['subject'], 'body': '\n'.join(lines),
            'authentication': auth, 'decoding': decoded['decoding']}
