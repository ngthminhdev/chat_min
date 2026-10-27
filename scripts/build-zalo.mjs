import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {patchListener} from '../connectors/zalo/sdk-patches.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'connectors/zalo');
if(!fs.existsSync(path.join(source,'node_modules/zca-js/package.json')))execFileSync('npm',['ci','--ignore-scripts'],{cwd:source,stdio:'inherit'});
const out=path.join(root,'src-tauri/resources/zalo');fs.mkdirSync(out,{recursive:true});
await build({entryPoints:[path.join(source,'main.mjs')],outfile:path.join(out,'connector.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning',plugins:[{name:'zca-history-metadata',setup(b){b.onLoad({filter:/zca-js[/\\]dist[/\\]apis[/\\]listen\.js$/},args=>({contents:patchListener(fs.readFileSync(args.path,'utf8')),loader:'js'}));}}]});
const node=path.join(out,process.platform==='win32'?'node.exe':'node');
if(!fs.existsSync(node) || fs.statSync(node).size!==fs.statSync(process.execPath).size)fs.copyFileSync(process.execPath,node);
fs.chmodSync(node,0o755);
// Ship redistribution notices with the runtime and all bundled npm dependencies.
const notices=[];
const nodeLicense=path.resolve(path.dirname(process.execPath),'../LICENSE');
if(fs.existsSync(nodeLicense))notices.push('Node.js\n'+fs.readFileSync(nodeLicense,'utf8'));
for(const entry of fs.readdirSync(path.join(source,'node_modules'),{withFileTypes:true})){
  if(!entry.isDirectory() || entry.name.startsWith('.'))continue;
  const dir=path.join(source,'node_modules',entry.name);
  const license=fs.readdirSync(dir).find(f=>/^(license|copying)(\..*)?$/i.test(f));
  if(license)notices.push(entry.name+'\n'+fs.readFileSync(path.join(dir,license),'utf8'));
}
fs.writeFileSync(path.join(out,'THIRD-PARTY-NOTICES.txt'),notices.join('\n\n--------------------\n\n'));
console.log('Zalo connector and Node runtime bundled');
