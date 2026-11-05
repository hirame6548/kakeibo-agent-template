const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../Index.html'),'utf8');
const render=html.slice(html.indexOf('  function renderCsv13(){'),html.indexOf("  document.addEventListener('click',async e=>{",html.indexOf('  function renderCsv13(){')));
function preview(source){
  const panel={innerHTML:''},row={row_number:1,candidate_purchase_ids:[],source},before=JSON.stringify(row);
  const ctx={document:{getElementById:()=>panel},state:{transactions:[]},csv13Input:{card:'olive',file:{billing_month:'2098-11'}},csv13Result:{review:{rows:[row]}},CARD_LABEL:{olive:'Olive'},h:s=>String(s),yen:n=>'¥'+Number(n).toLocaleString('ja-JP')};
  vm.runInNewContext(render+';renderCsv13();',ctx);a.equal(JSON.stringify(row),before);return panel.innerHTML;
}
for(const [name,source] of [['null',{billed_jpy:null}],['omitted',{}],['undefined',{billed_jpy:undefined}]])test('CSV13 missing billed amount displays 記載なし: '+name,()=>{const result=preview(source);a.match(result,/／請求 記載なし<select/);a.doesNotMatch(result,/NaN|／請求 ¥0/);});
for(const [value,expected] of [[0,'¥0'],[3615,'¥3,615'],[-1100,'¥-1,100']])test('CSV13 listed billed amount keeps value: '+value,()=>{a.ok(preview({billed_jpy:value}).includes('／請求 '+expected+'<select'));});
