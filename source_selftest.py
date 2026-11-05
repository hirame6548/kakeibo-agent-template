"""Synthetic source/capability integration tests, temporary files only."""
import base64, json, pathlib, subprocess, sys, tempfile
from selftest import raw
ROOT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'worker'))
from source_evidence import source_records
from decode_mail import DecodeError
box='mailbox-A'
encoded=base64.urlsafe_b64encode(raw('Synthetic receipt','Synthetic product 100 JPY')).decode()
sources={'schema_version':1,'provenance':'gmail_api_raw','messages':[{'mailbox':box,'message_id':'deadbeef1234','raw_base64url':encoded}]}
records=source_records(sources,[box],['statement@vpass.ne.jp'])
assert len(records)==1 and 'body' not in records[0] and 'auth_pass' not in records[0]
for bad in [dict(sources,messages=[dict(sources['messages'][0],message_id='invented')]),dict(sources,messages=sources['messages']*2)]:
    try: source_records(bad,[box],['statement@vpass.ne.jp']); raise AssertionError('accepted invalid source')
    except DecodeError: pass
bad=json.loads(json.dumps(sources));bad['messages'][0]['raw_base64url']=base64.urlsafe_b64encode(base64.urlsafe_b64decode(encoded).replace(b'dmarc=pass',b'dmarc=fail')).decode()
try: source_records(bad,[box],['statement@vpass.ne.jp']);raise AssertionError('accepted auth fail')
except DecodeError:pass
# Multiple DKIM outcomes inside one authoritative receiver header: aligned pass wins,
# unrelated pass alone never substitutes for sender alignment. SPF/DMARC stay strict.
base = base64.urlsafe_b64decode(encoded)
def check_dkim(extra, replacement=None, succeeds=True):
    altered = base.replace(b'; spf=pass', extra + b'; spf=pass', 1)
    if replacement: altered = altered.replace(*replacement)
    data = json.loads(json.dumps(sources))
    data['messages'][0]['raw_base64url'] = base64.urlsafe_b64encode(altered).decode()
    try:
        source_records(data,[box],['statement@vpass.ne.jp'])
        assert succeeds, 'accepted invalid DKIM/header combination'
    except DecodeError:
        assert not succeeds, 'rejected valid aligned DKIM pass'
check_dkim(b'; dkim=pass header.i=@amazonses.com')
check_dkim(b'; dkim=fail header.i=@amazonses.com')
check_dkim(b'; dkim=fail header.i=@vpass.ne.jp')
check_dkim(b'; dkim=pass header.i=@amazonses.com', (b'dkim=pass header.i=@vpass.ne.jp',b'dkim=fail header.i=@vpass.ne.jp'), False)
check_dkim(b'; dkim=pass header.i=@vpass.ne.jp', (b'dkim=pass header.i=@vpass.ne.jp',b'dkim=fail header.i=@vpass.ne.jp'), False)
check_dkim(b'; dkim=pass header.i=@vpass.ne.jp')
check_dkim(b'',(b'Authentication-Results: mx.google.com;',b'Authentication-Results: mx.google.com; dkim=pass header.i=@vpass.ne.jp\r\nAuthentication-Results: mx.google.com;'),False)
check_dkim(b'',(b'Authentication-Results: mx.google.com;',b'Authentication-Results: fake.invalid;'),False)
check_dkim(b'',(b'spf=pass',b'spf=fail'),False)
check_dkim(b'',(b'header.from=vpass.ne.jp',b'header.from=unrelated.invalid'),False)

with tempfile.TemporaryDirectory() as tmp:
    d=pathlib.Path(tmp);now='2000-10-26T00:00:00Z'
    ledger={'revision':8,'requests':[],'state':{'v':2,'as_of':'2000-10-26','transactions':[{'id':'synthetic','source':'csv','card':'olive','used_at':'2000-10-08','merchant_raw':'SYNTHETIC','merchant_key':'SYNTHETIC','amount_jpy':100,'category':'生活用品','frame':'goods','status':'provisional','match_status':'matched','description':None}], 'assets':[],'rules':[],'history':{},'settings':{'bigThreshold':30000},'metadata':{'categories':[],'accounts':[],'detail_candidates':[]},'mail_exchange_log':[{'run_id':'synthetic-capability-0001','at':now,'report':{'run_id':'synthetic-capability-0001','execution_status':'succeeded','capabilities':{'purchase_details':'purchase-details-v5-fullrow-verified-readback','execution_path':'head_pull','exchange_schema_versions':[1,2]}}}]}}
    for name,obj in [('raw.json',{'schema_version':1,'provenance':'gmail_api_raw','messages':[]}),('ledger.json',ledger),('sources.json',sources)]: (d/name).write_text(json.dumps(obj))
    common=['--input',str(d/'raw.json'),'--ledger',str(d/'ledger.json'),'--mailboxes',json.dumps([box]),'--generated-at',now]
    def run(op,out,extra=[],success=True):
        result=subprocess.run([sys.executable,str(ROOT/'worker/cloud_entry.py'),op,*common,'--output',str(d/out),*extra],capture_output=True)
        assert (result.returncode==0)==success, result.stderr.decode()[-400:]
        assert (d/out).exists()==success
    run('prepare','prepare.json');item=json.loads((d/'prepare.json').read_text())['details_pending']['items'][0]
    details={'schema_version':1,'mode':'purchase_details','run_id':'synthetic-details-0001','results':[{'id':item['id'],'input_version':item['input_version'],'match_status':'matched','search_performed':True,'description':'Synthetic product','evidence':'Synthetic receipt item field, date and total','source_mailbox':box,'source_message_ids':['deadbeef1234'],'source_facts':{'date':'2000-10-08','date_kind':'shipment','amount':100,'currency':'JPY'}}]}
    (d/'details.json').write_text(json.dumps(details))
    extra=['--run-id','synthetic-details-outer-0001','--details',str(d/'details.json'),'--sources',str(d/'sources.json'),'--source-senders','["statement@vpass.ne.jp"]']
    run('validate','valid.json',extra);output=json.loads((d/'valid.json').read_text());assert output['exchange']['schema_version']==2;assert output['exchange_report']['details']['outcomes'][0]['status']=='saved';assert output['existing_financial_fields_unchanged']
    # Exercise the portable confirm CLI: dry-run is incomplete, actual synthetic
    # Core journal+details readback is complete. No production I/O.
    def confirm_cli(after, name, success):
        path=d/(name+'-after.json');path.write_text(json.dumps(after))
        result=subprocess.run([sys.executable,str(ROOT/'worker/cloud_entry.py'),'confirm',
            '--after',str(path),'--expected',str(d/'valid.json'),'--output',str(d/(name+'-confirm.json'))],capture_output=True)
        assert (result.returncode==0)==success, result.stderr.decode()[-400:]
        assert json.loads((d/(name+'-confirm.json')).read_text())['complete']==success
    confirm_cli(ledger,'not-imported',False)
    script = """const fs=require('fs'),r=process.argv[1],x=JSON.parse(fs.readFileSync(0));
    for(const [n,f] of Object.entries({KakeiboCore:'Core',KakeiboMail:'Mail',KakeiboClassification:'Classification',KakeiboPurchaseDetails:'PurchaseDetails',KakeiboMailExchange:'MailExchange'}))global[n]=require(r+'/webapp/'+f);
    const crypto=require('crypto'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
    const state=KakeiboCore.apply(KakeiboCore.validate(x.ledger.state),{type:'applyMailExchange',exchangeFile:x.exchange},x.now,'2000-10-26',{hash,allowedMailboxes:['mailbox-A'],executionPath:'head_pull'});
    console.log(JSON.stringify({revision:x.ledger.revision+1,state,requests:[]}));"""
    applied=subprocess.run(['node','-e',script,str(ROOT)],input=json.dumps({'ledger':ledger,'exchange':output['exchange'],'now':now}),text=True,capture_output=True,check=True)
    confirm_cli(json.loads(applied.stdout),'imported-synthetic',True)
    run('validate','missing-sources.json',extra[:4],False)
    for change in ['old-success','future','wrong-capability','old-v3-capability','schema-missing','schema-unsupported','failed','wrong-path','absent']:
        copy=json.loads(json.dumps(ledger))
        if change=='old-success':copy['state']['mail_exchange_log'][0]['at']='2000-10-25T00:00:00Z'
        elif change=='future':copy['state']['mail_exchange_log'][0]['at']='2000-10-27T00:00:00Z'
        elif change=='wrong-capability':copy['state']['mail_exchange_log'][0]['report']['capabilities']['purchase_details']='unknown'
        elif change=='old-v3-capability':copy['state']['mail_exchange_log'][0]['report']['capabilities']['purchase_details']='purchase-details-v2-global-runs-source-roots'
        elif change=='schema-missing':copy['state']['mail_exchange_log'][0]['report']['capabilities'].pop('exchange_schema_versions')
        elif change=='schema-unsupported':copy['state']['mail_exchange_log'][0]['report']['capabilities']['exchange_schema_versions']=[1]
        elif change=='failed':copy['state']['mail_exchange_log'][0]['report']['execution_status']='failed'
        elif change=='wrong-path':copy['state']['mail_exchange_log'][0]['report']['capabilities']['execution_path']='web'
        else:copy['state'].pop('mail_exchange_log')
        (d/'ledger.json').write_text(json.dumps(copy));run('validate',change+'.json',extra,change=='old-success')
    (d/'ledger.json').write_text(json.dumps(ledger));details['results'][0]['source_message_ids']=['deadbeef9999'];(d/'details.json').write_text(json.dumps(details));run('validate','invented-id.json',extra,False)
print('PASS: source raw ID/auth boundary + missing/invented evidence + successful HEAD history (no age expiry) + schema2 + no financial mutation')
