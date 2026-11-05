'use strict';
const fs=require('node:fs');
function validate(p){
 if(!p||p.schema_version!==1)throw Error('PROFILE_SCHEMA_REQUIRED');
 if(p.profile!=='google-smbc-v1')throw Error('UNSUPPORTED_PROFILE');
 if(!['demo','personal'].includes(p.ledger_mode))throw Error('INVALID_MODE');
 for(const k of ['owner_email','ledger_spreadsheet_id','mail_inbox_folder_id','mail_inbox_parent_id'])if(typeof p[k]!=='string'||!p[k]||p[k].startsWith('REPLACE_')||p[k].endsWith('.invalid'))throw Error('NOT_CONFIGURED:'+k);
 if(!Array.isArray(p.mailbox_aliases)||!p.mailbox_aliases.length||!p.mailbox_aliases.every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x))||new Set(p.mailbox_aliases).size!==p.mailbox_aliases.length)throw Error('MAILBOX_ALIASES_REQUIRED');
 if(!Array.isArray(p.accounts)||!p.accounts.every(x=>typeof x==='string'&&x.trim()===x&&x.length>0)||new Set(p.accounts).size!==p.accounts.length)throw Error('ACCOUNTS_REQUIRED');
 if(!p.classification_policy||p.classification_policy.unknown!=='provisional'||!Array.isArray(p.classification_policy.merchant_rules))throw Error('POLICY_REQUIRED');
 if(p.classification_policy.merchant_rules.length)throw Error('MERCHANT_RULES_NOT_SUPPORTED');
 return {ok:true,profile:p.profile,mode:p.ledger_mode,properties:['OWNER_EMAIL','LEDGER_SPREADSHEET_ID','LEDGER_MODE','MAIL_INBOX_FOLDER_ID','MAIL_INBOX_PARENT_ID','MAILBOX_ALIASES','LEDGER_ACCOUNTS_JSON']};
}
module.exports={validate};if(require.main===module){try{console.log(JSON.stringify(validate(JSON.parse(fs.readFileSync(process.argv[2],'utf8')))));}catch(e){console.error(e.message);process.exitCode=2;}}
