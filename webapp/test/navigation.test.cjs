const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../Index.html'),'utf8');
const start=html.indexOf("  document.addEventListener('click', e => {");
const end=html.indexOf("  document.addEventListener('change', e => {",start);
function run(href,overrides={}) {
  let callback,prevented=false;const calls=[];
  const context={document:{addEventListener:(name,fn)=>callback=fn},PAGES:['overview','review','assets'],busy:false,state:{},pendingRequest:null,goTo:p=>{assert.equal(prevented,true,'prevent top navigation BEFORE routing');calls.push(p);},...overrides};
  vm.runInNewContext(html.slice(start,end),context);
  const anchor={getAttribute:()=>href};
  // A click on an SVG/path/text inside the anchor must resolve to its ancestor.
  callback({target:{closest:selector=>selector==='a[href^="#"]'&&href.startsWith('#')?anchor:null},preventDefault:()=>prevented=true});
  return {calls,prevented};
}
test('all shipped internal hash routes stay inside the HTML-Service iframe',()=>{
  assert.ok(html.includes('<base target="_top">'),'retain external-link base behavior');
  const routes=[...html.matchAll(/href="#([^"]+)"/g)].map(m=>m[1]);assert.ok(routes.length>=6);
  for(const page of routes)assert.deepEqual(run('#'+page),{calls:[page],prevented:true});
});
test('external/relative URLs and unknown hashes retain native behavior',()=>{
  for(const href of ['https://example.invalid/','mailto:owner@example.invalid','/other','#unknown'])assert.deepEqual(run(href),{calls:[],prevented:false});
});
test('loading, pending writes and busy state block app navigation without escaping iframe',()=>{
  for(const state of [{busy:true},{state:null},{pendingRequest:{requestId:'pending'}}])assert.deepEqual(run('#assets',state),{calls:[],prevented:true});
});
test('page-top navigation resets mobile content scroller and retains desktop window scrolling',()=>{
 const source=html.slice(html.indexOf('  function scrollPageTop() {'),html.indexOf('  function showPage(focus) {'));
 for(const mobile of [true,false]){const calls=[],ctx={document:{getElementById:()=>({scrollTo:(x,y)=>calls.push(['content',x,y])})},window:{matchMedia:()=>({matches:mobile}),scrollTo:(x,y)=>calls.push(['window',x,y])}};vm.runInNewContext(source+';scrollPageTop();',ctx);assert.deepEqual(calls,[[mobile?'content':'window',0,0]]);}
});
