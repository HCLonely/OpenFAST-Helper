// Build-time only: runtime uses the bundled index and never fetches documentation.
import {parse} from 'parse5';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='https://openfast.readthedocs.io/en/main/source/user/';
const modules={OpenFAST:'glue-code',ElastoDyn:'elastodyn',HydroDyn:'hydrodyn',SeaState:'seastate',InflowWind:'inflowwind',ServoDyn:'servodyn',MoorDyn:'moordyn',AeroDyn:'aerodyn',BeamDyn:'beamdyn',SubDyn:'subdyn',TurbSim:'turbsim'};
const catalog=JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8'));
const names=new Set(catalog.parameters.map(x=>x.name.toLowerCase()));
const cache=path.join(root,'test-results/docs');await fs.mkdir(cache,{recursive:true});
const attr=(node,key)=>node.attrs?.find(x=>x.name===key)?.value;
const text=node=>node.nodeName==='#text'?node.value:(node.childNodes||[]).map(text).join('');
function* walk(node){yield node;for(const child of node.childNodes||[])yield* walk(child);}
const clean=node=>text(node).replace(/\s+/g,' ').trim();
async function load(url){
  const filename=path.join(cache,new URL(url).pathname.replace(/\//g,'_'));
  let html;try{
    if((await fs.stat(filename)).mtime.toISOString().slice(0,10)!==new Date().toISOString().slice(0,10))throw new Error('stale cache');
    html=await fs.readFile(filename,'utf8');
  }catch{
    const response=await fetch(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);
    html=await response.text();await fs.writeFile(filename,html);
  }
  return parse(html);
}
function body(tree){return [...walk(tree)].find(n=>attr(n,'role')==='main')||tree;}
function location(node){
  for(let n=node;n;n=n.parentNode){
    if((n.tagName==='section'||(n.tagName==='div'&&attr(n,'class')?.split(' ').includes('section')))&&attr(n,'id')){
      const heading=n.childNodes?.find(x=>/^h[1-6]$/.test(x.tagName||''));
      return {anchor:attr(n,'id'),section:heading?clean(heading).replace(//g,'').trim():attr(n,'id')};
    }
  }
  return null;
}
const entries={};const pages=[];const failures=[];
for(const [module,folder] of Object.entries(modules)){
  const prefix=base+folder+'/';const queue=[prefix+'index.html'];const visited=new Set();
  if(module==='MoorDyn')queue.push('https://moordyn.readthedocs.io/en/latest/inputs.html');
  while(queue.length){
    const batch=queue.splice(0,6).filter(url=>!visited.has(url));batch.forEach(url=>visited.add(url));
    const results=await Promise.allSettled(batch.map(async url=>({url,tree:await load(url)})));
    for(let i=0;i<results.length;i++){
      const result=results[i];if(result.status==='rejected'){failures.push(String(result.reason));continue;}
      const {url,tree}=result.value;const content=body(tree);pages.push(url);
      for(const node of walk(content)){
        if(node.tagName==='a'&&attr(node,'href')){
          const target=new URL(attr(node,'href'),url);target.hash='';
          if(target.href.startsWith(prefix)&&target.pathname.endsWith('.html')&&!/append|example|output|theory|verification|reference/i.test(target.pathname)&&!visited.has(target.href)&&!queue.includes(target.href))queue.push(target.href);
        }
        if(module==='OpenFAST'&&!url.endsWith('/linearization.html'))continue;
        if(!['p','dt','tr'].includes(node.tagName))continue;
        // Require a real descriptive block, not a bare name or sample-input listing.
        let prose=clean(node);
        // ServoDyn puts a label and units in one paragraph, its definition in
        // the immediately following blockquote. Treat these as one entry.
        const siblings=node.parentNode?.childNodes||[];
        const next=siblings.slice(siblings.indexOf(node)+1).find(x=>x.tagName);
        if(['blockquote','dd'].includes(next?.tagName))prose+=' '+clean(next);
        if(prose.length<20)continue;
        const loc=location(node);if(!loc)continue;
        const labels=[...walk(node)].filter(x=>['strong','code','dt','em'].includes(x.tagName)).map(clean);
        const plain=/^([A-Za-z]\w*(?:\(\d+\))?)\s+(?:\([^)]*\)\s*)?[–\-:]/.exec(prose);
        if(plain)labels.push(plain[1]);
        for(const label of labels){
          const name=label.toLowerCase();if(!names.has(name))continue;
          if(prose.replace(label,'').replace(/[\s:–\-()]/g,'').length<12)continue;
          const score=prose.toLowerCase().startsWith(name)?3:2;
          const key=module+':'+name;
          if(!entries[key]||score>entries[key].score)entries[key]={url:url+'#'+loc.anchor,section:loc.section,score};
        }
      }
    }
  }
  console.log(`${module}: ${visited.size} pages, ${Object.keys(entries).filter(k=>k.startsWith(module+':')).length} parameter links`);
}
for(const entry of Object.values(entries))delete entry.score;
Object.assign(entries,JSON.parse(await fs.readFile(path.join(root,'data/version-doc-links.json'),'utf8')));
const output={schemaVersion:1,source:'https://openfast.readthedocs.io/en/main/source/this_doc.html',branch:'main',checkedOn:new Date().toISOString().slice(0,10),entries:Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)))};
await fs.writeFile(path.join(cache,'link-build-report.json'),JSON.stringify({pages,failures,links:Object.keys(entries).length},null,2));
if(failures.length)throw new Error('Documentation fetch failed: '+failures.join('; '));
await fs.writeFile(path.join(root,'data/doc-links.json'),JSON.stringify(output,null,2)+'\n');
console.log(`Bundled ${Object.keys(entries).length} verified paragraph/section links.`);
