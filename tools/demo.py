"""Offline synthetic prepare -> validate -> in-memory mock commit -> full confirm.
The mock is not a storage/connector adapter and does not prove real GAS deployment.
"""
import base64, datetime, json, pathlib, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from selftest import raw
out=pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True,exist_ok=True)
if any(out.iterdir()): raise SystemExit('Demo requires an empty directory')
def save(name,value):
    p=out/name
    with p.open('x') as f: json.dump(value,f,ensure_ascii=False)
    p.chmod(0o600)
    return str(p)
now=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=2)).isoformat().replace('+00:00','Z')
day=now[:10]
body=f'架空宛名 様\nご利用カード：Ｏｌｉｖｅ／クレジット\n◇利用日：{day.replace("-","/")} 00:00\n◇利用先：架空商店\n◇利用取引：買物\n◇利用金額：123円'
input_path=save('raw.json',{'schema_version':1,'provenance':'gmail_api_raw','messages':[{'mailbox':'synthetic-demo','message_id':'deadbeef0001','raw_base64url':base64.urlsafe_b64encode(raw('ご利用のお知らせ【三井住友カード】',body)).decode()}]})
ledger={'revision':0,'requests':[],'state':{'v':2,'as_of':day,'transactions':[],'assets':[],'rules':[],'history':{},'settings':{'bigThreshold':30000},'metadata':{'categories':[],'accounts':[],'detail_candidates':[]}}}
ledger_path=save('before.json',ledger)
entry=[sys.executable,str(ROOT/'worker/cloud_entry.py')]
common=['--input',input_path,'--ledger',ledger_path,'--mailboxes','["synthetic-demo"]','--generated-at',now]
subprocess.run(entry+['prepare',*common,'--output',str(out/'prepared.json')],check=True)
prepared=json.loads((out/'prepared.json').read_text())
classification={'schema_version':1,'classification_mode':'provisional','run_id':'synthetic-demo-class','results':[{'id':i['id'],'input_version':i['input_version'],'match_status':'no_candidate','detail_msg_id':None,'candidate_msg_ids':[],'category':'その他','description':'購入内容不明','evidence':'Synthetic demo only','confidence':0.1,'items':[],'rule_suggestion':None} for i in prepared['pending']['items']]}
class_path=save('classification.json',classification)
subprocess.run(entry+['validate',*common,'--run-id','synthetic-demo-outer','--classification',class_path,'--output',str(out/'validated.json'),'--exchange-output',str(out/'exchange.json')],check=True)
# Only mock the sole writer locally; use the exact validate output, never model JSON.
script="""
const fs=require('node:fs'),root=process.argv[1];
for(const n of ['Csv13Stage','Core','Csv','Mail','Classification','BillingCheck','MailExchange','PurchaseDetails'])global['Kakeibo'+n]=require(root+'/webapp/'+n);
const x=JSON.parse(fs.readFileSync(0,'utf8')),crypto=require('node:crypto');
const tools={...require(root+'/gas/parsers'),hash:s=>crypto.createHash('sha256').update(s).digest('hex'),allowedMailboxes:['synthetic-demo'],executionPath:'head_pull'};
const state=KakeiboCore.apply(x.ledger.state,{type:'applyMailExchange',exchangeFile:x.validated.exchange},x.validated.generated_at,x.ledger.state.as_of,tools);
console.log(JSON.stringify({tables:require(root+'/webapp/Store').encode({revision:1,state,requests:[]})}));
"""
validated=json.loads((out/'validated.json').read_text())
result=subprocess.run(['node','-e',script,str(ROOT)],input=json.dumps({'ledger':ledger,'validated':validated}),capture_output=True,text=True,check=True)
save('after.json',json.loads(result.stdout))
subprocess.run(entry+['confirm','--after',str(out/'after.json'),'--expected',str(out/'validated.json'),'--output',str(out/'confirmed.json')],check=True)
assert json.loads((out/'confirmed.json').read_text())['complete']
print('PASS: synthetic offline prepare -> validate -> mock commit -> full-row confirm + actual-clock guard')
