"""Offline exact archive/member verification. No extraction, network, or writes."""
import hashlib,json,sys,tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1],'r:gz') as t:
 ms=t.getmembers();names=[m.name for m in ms]
 if len(names)!=len(set(names)):raise SystemExit('duplicate member')
 for m in ms:
  p=PurePosixPath(m.name)
  if not m.isfile() or p.is_absolute() or '..' in p.parts:raise SystemExit('unsafe member')
 manifest=json.load(t.extractfile('PUBLIC-MANIFEST.json'))
 allowlist=json.load(t.extractfile('tools/release-files.json'))
 if len(allowlist)!=len(set(allowlist)) or set(allowlist)!=set(manifest['files']):raise SystemExit('allowlist mismatch')
 if set(names)!=set(manifest['files'])|{'PUBLIC-MANIFEST.json'}:raise SystemExit('unexpected/missing archive member')
 for name,spec in manifest['files'].items():
  b=t.extractfile(name).read()
  if len(b)!=spec['bytes'] or hashlib.sha256(b).hexdigest()!=spec['sha256']:raise SystemExit('content mismatch')
 print(json.dumps({'ok':True,'members':len(names),'version':manifest['version']}))
