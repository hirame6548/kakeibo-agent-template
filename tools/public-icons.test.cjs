'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../webapp/Index.html'),'utf8');
test('thirteen preview icons use new primitive compositions with accessible wrapper',()=>{
 const source=html.match(/const ICONS = (\{[\s\S]*?\n  \});/)[1],icons=vm.runInNewContext('('+source+')');
 a.deepEqual(Object.keys(icons),['left','right','down','check','food','goods','home','transport','hobby','work','medical','other','pending']);
 for(const [key,markup] of Object.entries(icons)){
  a.ok(markup.length,key);a.doesNotMatch(markup,/<path|<image|href|style|script/i);
  a.ok([...markup.matchAll(/<([a-z]+)/g)].every(m=>['line','polyline','rect','circle'].includes(m[1])),key);
 }
 a.match(html,/viewBox="0 0 24 24" aria-hidden="true" focusable="false">\$\{ICONS\[name\]\}/);
 a.doesNotMatch(html,/<path\b/); // includes the four replaced static brand/navigation drawings
 a.match(html,/class="asset-chart"[\s\S]*?role="img" aria-label=/);
});
test('mailbox alias grammar agrees between setup CLI and GAS consumer',()=>{
 const {validate}=require('./check-config.cjs');
 const p={schema_version:1,profile:'google-smbc-v1',ledger_mode:'demo',owner_email:'tester@example.test',ledger_spreadsheet_id:'synthetic',mail_inbox_folder_id:'synthetic',mail_inbox_parent_id:'synthetic',accounts:[],classification_policy:{unknown:'provisional',merchant_rules:[]}};
 const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../webapp/Code.gs'),'utf8'),ctx);
 for(const alias of ['a','Box_01-safe','a'.repeat(80)]){a.equal(validate({...p,mailbox_aliases:[alias]}).ok,true);a.equal(ctx.configuredNames_(JSON.stringify([alias]),'MAILBOX_NOT_CONFIGURED',true)[0],alias);}
 for(const alias of ['#','box#1','a'.repeat(81),'日本語',' a','a ']){a.throws(()=>validate({...p,mailbox_aliases:[alias]}),/MAILBOX/);a.throws(()=>ctx.configuredNames_(JSON.stringify([alias]),'MAILBOX_NOT_CONFIGURED',true),/MAILBOX/);}
});
