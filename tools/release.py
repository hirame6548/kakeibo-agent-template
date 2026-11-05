"""Rebuild a source-only manifest/archive from the reviewed explicit file allowlist."""
import hashlib, io, json, pathlib, sys, tarfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
names=json.loads((ROOT/'tools/release-files.json').read_text())
assert len(names)==len(set(names)) and 'PUBLIC-MANIFEST.json' not in names
files={}
for name in names:
    p=pathlib.PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts: raise SystemExit('unsafe path')
    source=ROOT/name
    if source.is_symlink() or not source.is_file(): raise SystemExit('not a regular file: '+name)
    data=source.read_bytes(); files[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
manifest={'version':'kakeibo-developer-preview-v3','files':files}
(ROOT/'PUBLIC-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
if len(sys.argv)>1:
    target=pathlib.Path(sys.argv[1])
    with tarfile.open(target,'w:gz') as archive:
        for name in sorted(names+['PUBLIC-MANIFEST.json']):
            data=(ROOT/name).read_bytes(); item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o644;item.mtime=0
            archive.addfile(item,io.BytesIO(data))
    data=target.read_bytes(); print(json.dumps({'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'members':len(names)+1}))
else: print(json.dumps({'manifest_files':len(files)}))
