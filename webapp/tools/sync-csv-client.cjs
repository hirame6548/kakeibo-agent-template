// Embed the SAME pure CSV parser in the single HTML; no third-party browser library.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const target=path.join(root,'Index.html');let html=fs.readFileSync(target,'utf8');
const begin='/* CSV_PARSER_BEGIN */',end='/* CSV_PARSER_END */',source=fs.readFileSync(path.join(root,'Csv.js'),'utf8').replace(/<\/script/gi,'<\\/script');
const block='<script>\n'+begin+'\n'+source+end+'\n</script>\n';
if(html.includes(begin)){const a=html.lastIndexOf('<script>',html.indexOf(begin)),b=html.indexOf('</script>',html.indexOf(end))+9;html=html.slice(0,a)+block.trimEnd()+html.slice(b);}
else html=html.replace('<script>',block+'<script>');
fs.writeFileSync(target,html);

for(const name of ['Csv13','Csv13Review']){const begin='/* '+name+'_BEGIN */',end='/* '+name+'_END */',source=fs.readFileSync(path.join(root,name+'.js'),'utf8').replace(/<\/script/gi,'<\\/script'),block='<script>\n'+begin+'\n'+source+end+'\n</script>\n';if(html.includes(begin)){const a=html.lastIndexOf('<script>',html.indexOf(begin)),b=html.indexOf('</script>',html.indexOf(end))+9;html=html.slice(0,a)+block.trimEnd()+html.slice(b);}else html=html.replace('<script>',block+'<script>');}
fs.writeFileSync(target,html);
