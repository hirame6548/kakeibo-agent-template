'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
for(const n of ['Csv13Stage','Core','Csv','Mail','Classification','MailExchange','PurchaseDetails'])global['Kakeibo'+n]=require('../webapp/'+n);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('public confirm enforces actual clock and ignores model-authored observed_at',()=>{
 const Core=global.KakeiboCore,E=global.KakeiboMailExchange,Confirm=require('../worker/confirm_details.cjs');
 const now='2098-10-26T00:00:00Z',s=Core.empty({categories:[],accounts:[],detail_candidates:[]},'2098-10-26'),exchange={schema_version:1,run_id:'synthetic-future',generated_at:now,classification_file:{schema_version:1,classification_mode:'provisional',run_id:'synthetic-empty-class',results:[]}},tools={hash,allowedMailboxes:['box-A'],executionPath:'head_pull'};
 const p=E.plan(s,exchange,tools,now),expected=Confirm.expectations(s,p.state,exchange,p.report),after=Core.apply(s,{type:'applyMailExchange',exchangeFile:exchange},now,s.as_of,tools);
 a.equal(Confirm.confirm(after,expected).complete,true);
 const result=cp.spawnSync('node',[path.join(root,'worker/confirm-run.cjs')],{input:JSON.stringify({after:{state:after},validated:{generated_at:now,exchange,confirmation_expectations:expected},observed_at:'2099-01-01T00:00:00Z'}),encoding:'utf8'});
 a.equal(result.status,0,result.stderr);const out=JSON.parse(result.stdout);a.equal(out.complete,false);a.equal(out.observed_clock.ok,false);a.ok(out.reasons.includes('generated_at_invalid_or_future'));
});
