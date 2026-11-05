"""Synthetic mail only; no Gmail access."""
import base64
import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).parents[1] / 'worker' / 'decode_mail.py'
spec = importlib.util.spec_from_file_location('decode_mail', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def raw(body='架空商店\n◇利用金額：123円', charset='iso-2022-jp'):
    subject = base64.b64encode('ご利用のお知らせ【三井住友カード】'.encode(charset)).decode()
    headers = ('From: statement@vpass.ne.jp\r\n'
               f'Subject: =?{charset}?B?{subject}?=\r\n'
               'MIME-Version: 1.0\r\n'
               f'Content-Type: text/plain; charset={charset}\r\n'
               'Content-Transfer-Encoding: base64\r\n\r\n').encode()
    return headers + base64.b64encode(body.encode(charset))


class DecoderTests(unittest.TestCase):
    def test_iso2022_roundtrip_no_escape_or_replacement(self):
        r = mod.decode_rfc2822(raw())
        self.assertIn('架空商店', r['body'])
        self.assertEqual(r['subject'], 'ご利用のお知らせ【三井住友カード】')
        self.assertEqual(r['decoding']['source'], 'raw_mime')
        self.assertNotIn('authentication', r)

    def test_utf8_roundtrip(self):
        self.assertEqual(mod.decode_rfc2822(raw(charset='utf-8'))['body'], '架空商店\n◇利用金額：123円')

    def test_invalid_charset_bytes_reject(self):
        with self.assertRaises(mod.DecodeError):
            mod.decode_rfc2822(raw().split(b'\r\n\r\n')[0] + b'\r\n\r\n' + base64.b64encode(b'\x1b$B\xff\xff'))

    def test_duplicate_header_reject(self):
        with self.assertRaises(mod.DecodeError):
            mod.decode_rfc2822(b'From: evil@example.invalid\r\n' + raw())

    def test_html_only_reject(self):
        with self.assertRaises(mod.DecodeError):
            mod.decode_rfc2822(raw().replace(b'text/plain', b'text/html'))

    def test_untrusted_auth_header_is_not_attestation(self):
        result = mod.decode_rfc2822(b'Authentication-Results: mx.google.com; dmarc=pass\r\n' + raw())
        self.assertNotIn('authentication', result)




def authenticated_raw():
    prefix = (b'Received: from synthetic.example.invalid by mx.google.com with ESMTPS id synthetic; Tue, 1 Jan 2098 00:00:00 +0000\r\n'
              b'Received-SPF: pass (google.com: synthetic sender)\r\n'
              b'Authentication-Results: mx.google.com;\r\n'
              b' dkim=pass header.i=@vpass.ne.jp;\r\n'
              b' spf=pass;\r\n'
              b' dmarc=pass header.from=vpass.ne.jp\r\n')
    body = ('架空氏名 様\nご利用カード：Ｏｌｉｖｅ／クレジット\n'
            '◇利用日：2098/10/22 12:34\n◇利用先：架空商店\n'
            '◇利用取引：買物\n◇利用金額：123円\n不要な署名')
    return prefix + raw(body)


class ReceiverTests(unittest.TestCase):
    def test_receiver_pass_derived_from_raw_headers(self):
        result = mod.prepare_gmail_message('personal', 'abcdef01', authenticated_raw())
        self.assertEqual(result['authentication']['verification_method'], 'gmail_raw_headers_v1')
        self.assertEqual(len(result['authentication']['raw_sha256']), 64)
        self.assertIn('◇利用金額:123円', result['body'])
        self.assertNotIn('架空氏名', result['body'])
        self.assertNotIn('不要な署名', result['body'])

    def test_missing_duplicate_wrong_boundary_and_alignment_reject(self):
        r = authenticated_raw()
        invalid = [raw(), b'Authentication-Results: mx.google.com; dmarc=pass\r\n' + r,
                   r.replace(b'mx.google.com;', b'evil.example.invalid;'),
                   r.replace(b'by mx.google.com', b'by evil.example.invalid'),
                   r.replace(b'header.from=vpass.ne.jp', b'header.from=evil.example.invalid'),
                   r.replace(b'header.i=@vpass.ne.jp', b'header.i=@vpass.ne.jp.evil'),
                   r.replace(b'spf=pass;', b'spf=fail;'),
                   r.replace(b'Received-SPF: pass', b'Received-SPF: fail')]
        for value in invalid:
            with self.subTest(value=value[:30]), self.assertRaises(mod.DecodeError):
                mod.gmail_receiver_authentication(value)

    def test_body_auth_pass_is_not_receiver_evidence(self):
        with self.assertRaises(mod.DecodeError):
            mod.gmail_receiver_authentication(raw('Authentication-Results: mx.google.com; dmarc=pass'))


if __name__ == '__main__':
    unittest.main()
