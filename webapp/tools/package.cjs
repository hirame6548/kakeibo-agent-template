// Local packaging only: no login, clasp, Google project creation or deployment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
require('./sync-csv-client.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build','gas');fs.mkdirSync(out,{recursive:true});
const files={'PurchaseDetails.js':'PurchaseDetails.gs','Csv13Import.js':'Csv13Import.gs','Csv13.js':'Csv13.gs','Csv13Review.js':'Csv13Review.gs','Csv13Stage.js':'Csv13Stage.gs','MailPull.gs':'MailPull.gs','MailExchange.js':'MailExchange.gs','BillingCheck.js':'BillingCheck.gs','Mail.js':'Mail.gs','Classification.js':'Classification.gs','Csv.js':'Csv.gs','Core.js':'Core.gs','Store.js':'Store.gs','Code.gs':'Code.gs','DemoData.gs':'DemoData.gs','Index.html':'Index.html','appsscript.json':'appsscript.json','../gas/parsers.js':'Parsers.gs'};
const hashes={};for(const [source,target] of Object.entries(files)){const bytes=fs.readFileSync(path.join(root,source));if(target.endsWith('.gs'))new vm.Script(bytes.toString(),{filename:target});fs.writeFileSync(path.join(out,target),bytes);hashes[target]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
JSON.parse(fs.readFileSync(path.join(out,'appsscript.json')));
const html=fs.readFileSync(path.join(out,'Index.html'),'utf8');for(const [i,m] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].entries())new vm.Script(m[1],{filename:'Index-inline-'+i});
fs.writeFileSync(path.join(root,'build','SHA256.json'),JSON.stringify(hashes,null,2)+'\n');console.log(JSON.stringify({output:out,files:Object.keys(hashes)}));
