"""Product-source raw input boundary; no network, no signatures invented."""
import base64
import hashlib
import re
from email import policy
from email.parser import BytesParser
from decode_mail import DecodeError, _header, decode_rfc2822

def source_authentication(raw, allowed_senders):
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
    if len(from_headers) != 1 or len(addresses) != 1 or addresses[0][1].lower() not in allowed_senders:
        raise DecodeError('sender_mismatch')
    sender = addresses[0][1].lower()
    domain = re.escape(sender.rsplit('@', 1)[1])
    received = [i for i, (k, v) in enumerate(headers) if k.lower() == 'received'
                and re.search(r'\bby\s+mx\.google\.com\b', str(v), re.I)]
    if len(received) != 1 or not received[0] < ai < from_headers[0][0]:
        raise DecodeError('receiver_header_boundary')
    # Several DKIM signatures in ONE trusted receiver result are legitimate.
    # At least one passing signature must align exactly with the reviewed sender.
    dkims = [f.strip() for f in fields[1:] if re.match(r'^\s*dkim\s*=', f, re.I)]
    aligned_pass = [v for v in dkims if re.match(r'^dkim=pass(?:\s|$)', v, re.I)
                    and re.search(r'(?:^|\s)header\.i=(?:[^\s@;]+)?@' + domain + r'(?:\s|$)', v, re.I)]
    if not aligned_pass:
        raise DecodeError('dkim_aligned_pass_required')
    for mechanism in ['spf', 'dmarc']:
        matches = [f.strip() for f in fields[1:]
                   if re.match(r'^\s*' + mechanism + r'\s*=', f, re.I)]
        if len(matches) != 1 or not re.match(r'^' + mechanism + r'=pass(?:\s|$)', matches[0], re.I):
            raise DecodeError('receiver_auth_not_pass')
        if mechanism == 'dmarc' and not re.search(r'(?:^|\s)header\.from=' + domain + r'(?:\s|$)', matches[0], re.I):
            raise DecodeError('dmarc_alignment')
    spfs = [(i, str(v)) for i, (k, v) in enumerate(headers) if k.lower() == 'received-spf']
    if len(spfs) != 1 or not received[0] < spfs[0][0] < from_headers[0][0] or not re.match(r'^pass(?:\s|$)', spfs[0][1], re.I):
        raise DecodeError('received_spf_boundary')
    return {'receiver': 'gmail', 'from': sender, 'dmarc': 'pass',
            'aligned': True, 'verification_method': 'gmail_raw_headers_v1',
            'raw_sha256': hashlib.sha256(raw).hexdigest()}


def source_records(value, allowed_mailboxes, allowed_senders):
    # The orchestrator must supply this file directly from connector raw results,
    # separately from LLM result JSON. A provenance string alone proves nothing.
    if value.get('schema_version') != 1 or value.get('provenance') != 'gmail_api_raw':
        raise DecodeError('source_connector_raw_required')
    items = value.get('messages')
    if not isinstance(items, list) or len(items) > 100:
        raise DecodeError('source_message_limit')
    records, seen = [], set()
    for item in items:
        mailbox, mid = item.get('mailbox'), item.get('message_id')
        if mailbox not in allowed_mailboxes or not isinstance(mid, str) or not re.fullmatch(r'[a-f0-9]{1,32}', mid):
            raise DecodeError('source_identity_invalid')
        if (mailbox, mid) in seen:
            raise DecodeError('source_identity_duplicate')
        seen.add((mailbox, mid))
        encoded = item.get('raw_base64url')
        if not isinstance(encoded, str) or len(encoded) > 2700000:
            raise DecodeError('source_raw_invalid')
        raw = base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True)
        digest = hashlib.sha256(raw).hexdigest()
        if item.get('rfc2822_sha256') and item['rfc2822_sha256'] != digest:
            raise DecodeError('source_raw_hash_mismatch')
        auth = source_authentication(raw, allowed_senders)
        decoded = decode_rfc2822(raw)
        # Strict MIME decode is required even though body is not emitted/stored.
        records.append({'mailbox': mailbox, 'message_id': mid, 'raw_sha256': digest,
                        'verification_method': auth['verification_method'],
                        'sender': auth['from']})
    return records
