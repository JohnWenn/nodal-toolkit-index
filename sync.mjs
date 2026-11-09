import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,sep} from 'node:path';
import {githubRepo,repoRecord,registryRecord,mergeRecord,identify,metadataQueue,DATA_LICENSE} from './normalize.mjs';
const data=process.env.NODAL_INDEX_DATA_DIR?pathToFileURL(resolve(process.env.NODAL_INDEX_DATA_DIR)+sep):new URL('./data/',import.meta.url);await mkdir(data,{recursive:true});
const read=async(name,fallback)=>{try{return JSON.parse(await readFile(new URL(name,data),'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}};
const previous=await read('catalog.json',{resources:[],history:[],runs:[]});const state=await read('state.json',{mcp:{},awesomePage:1});
const seeds=JSON.parse(await readFile(new URL('./seeds.json',import.meta.url),'utf8'));
const at=new Date().toISOString(),records=new Map(previous.resources.map(r=>[r.id,r])),sources=[];
let requests=0,changed=0;const errors=[];
async function get(url,github=false){
 for(let attempt=0;attempt<2;attempt++){
  requests++;let r;try{r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'NODAL-Toolkit/1.0 (+https://nodal.xin)',...(github&&process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})},signal:AbortSignal.timeout(20000)})}catch(e){if(attempt===0)continue;throw e}
  if(r.status===429||r.status===403)throw Error(`HTTP ${r.status}; retry-after=${r.headers.get('retry-after')||'next scheduled run'}; ${new URL(url).host}`);
  if(r.status>=500&&attempt===0){await new Promise(resolve=>setTimeout(resolve,1000));continue}
  if(!r.ok)throw Error(`HTTP ${r.status}; ${new URL(url).host}`);
  if(Number(r.headers.get('content-length'))>8e6)throw Error('Response too large');const raw=await r.text();if(raw.length>8e6)throw Error('Response too large');return JSON.parse(raw);
 }throw Error('Request failed');
}
function put(record){if(!record)return;records.set(record.id,mergeRecord(records.get(record.id),record));changed++}
async function source(name,fn){try{const detail=await fn();sources.push({name,status:'ok',checkedAt:at,...detail})}catch(e){const error=String(e.message).slice(0,180);sources.push({name,status:'error',checkedAt:at,error});errors.push(name+': '+error)}}
await source('MCP Registry',async()=>{
 // Keep the same cursor and time window until every page in that window is consumed.
 const current={...state.mcp};current.startedAt||=at;
 let count=0;for(let page=0;page<2;page++){
  const url=new URL('https://registry.modelcontextprotocol.io/v0.1/servers');url.searchParams.set('limit','100');url.searchParams.set('version','latest');
  if(current.cursor)url.searchParams.set('cursor',current.cursor);if(current.since)url.searchParams.set('updated_since',current.since);
  const result=await get(url);if(!Array.isArray(result.servers)||!result.metadata)throw Error('Registry schema changed');
  const normalized=result.servers.map(r=>registryRecord(r,at));if(normalized.some(r=>!r))throw Error('Invalid registry record; cursor retained');normalized.forEach(put);count+=normalized.length;
  const next=result.metadata.nextCursor||null;if(next&&typeof next!=='string')throw Error('Invalid cursor');if(next===current.cursor&&next)throw Error('Repeated cursor');current.cursor=next;
  if(!next){current.since=new Date(Date.parse(current.startedAt)-600000).toISOString();current.startedAt=null;break}
 }
 state.mcp=current;return{count,continuation:!!current.cursor,mode:current.since?'incremental':'initial-index'};
});
await source('Ecosyste.ms Awesome',async()=>{
 const url=`https://awesome.ecosyste.ms/api/v1/lists/VoltAgent%2Fawesome-agent-skills/projects?per_page=25&page=${state.awesomePage}`;
 const result=await get(url);if(!Array.isArray(result))throw Error('Awesome schema changed');
 for(const project of result){const repo=githubRepo(project.url);if(!repo)continue;const id=identify(repo);const base=repoRecord({html_url:'https://github.com/'+repo},'Ecosyste.ms',at);base.type='Skill';base.classification='按 Awesome Agent Skills 列表自动分类，未人工核验';base.provenance=[{source:'Ecosyste.ms Awesome',url,checkedAt:at,license:DATA_LICENSE,via:'VoltAgent/awesome-agent-skills'}];if(records.has(id)){const old=records.get(id);put({...old,provenance:[...old.provenance,...base.provenance]})}else put(base)}
 state.awesomePage=result.length<25?1:state.awesomePage+1;return{count:result.length,page:state.awesomePage,license:DATA_LICENSE};
});
let githubAvailable=true;
await source('GitHub Discovery',async()=>{
 let count=0;for(const topic of ['agent-skills','mcp-server','agent-framework','agent-harness']){
  const url='https://api.github.com/search/repositories?'+new URLSearchParams({q:`topic:${topic} stars:>=20 archived:false fork:false`,sort:'updated',order:'desc',per_page:'8'});
  const result=await get(url,true);if(!Array.isArray(result.items))throw Error('GitHub search schema changed');for(const r of result.items){put(repoRecord(r,'GitHub',at));count++}
 }return{count};
});
const candidates=metadataQueue(seeds,[...records.values()]);
await source('Repository Metadata',async()=>{
 let count=0;const failures=[];
 for(const repo of candidates){
  let r,origin='GitHub';const old=records.get(identify(repo));
  try{if(!githubAvailable)throw Error('GitHub quota deferred');r=await get('https://api.github.com/repos/'+repo,true)}catch(e){if(/403|429/.test(e.message))githubAvailable=false;try{r=await get('https://repos.ecosyste.ms/api/v1/hosts/GitHub/repositories/'+encodeURIComponent(repo));origin='Ecosyste.ms'}catch(fallback){failures.push(repo+': '+fallback.message);if(old)records.set(old.id,{...old,metadataAttemptedAt:at,metadataError:fallback.message});continue}}
  const record=repoRecord(r,origin,at);if(!record){failures.push(repo+': invalid metadata');continue}
  if(record.stars===null){failures.push(repo+': invalid star count');continue}
  record.metadataCheckedAt=at;record.metadataAttemptedAt=at;record.metadataError=null;record.upstreamSyncedAt=r.last_synced_at||at;put(record);count++;
 }
 if(!count)throw Error('No repository metadata could be refreshed');return{count,partialErrors:failures.slice(0,8)};
});
const resources=[...records.values()].sort((a,b)=>a.id.localeCompare(b.id));
if(!resources.length||!sources.some(s=>s.status==='ok'))throw Error('All sources failed; retaining last good catalog');
const history=[...(previous.history||[])];if(previous.generatedAt&&(!history.length||Date.parse(previous.generatedAt)-Date.parse(history.at(-1).at)>=86400000))history.push({at:previous.generatedAt,stars:Object.fromEntries(previous.resources.filter(r=>Number.isInteger(r.stars)).map(r=>[r.id,r.stars]))});
const run={at,requests,updates:changed,total:resources.length,sources};const catalog={schemaVersion:1,generatedAt:at,license:DATA_LICENSE,attribution:['Ecosyste.ms Awesome / Repos — CC BY-SA 4.0','MCP Registry — linked publisher metadata','GitHub REST API — linked repository metadata'],resources,history:history.slice(-32),runs:[run,...previous.runs].slice(0,30)};
// One atomic public snapshot; state is checkpointed after publication, so a crash only repeats reads.
await writeFile(new URL('catalog.json.tmp',data),JSON.stringify(catalog,null,2)+'\n');await rename(new URL('catalog.json.tmp',data),new URL('catalog.json',data));
await writeFile(new URL('state.json.tmp',data),JSON.stringify(state,null,2)+'\n');await rename(new URL('state.json.tmp',data),new URL('state.json',data));
console.log(JSON.stringify(run));if(errors.length)console.error('Partial failures (last good records retained): '+errors.join('; '));
