import {createHash} from 'node:crypto';
export const DATA_LICENSE='CC-BY-SA-4.0';
export function githubRepo(value){
 try{const u=new URL(value);if(u.hostname!=='github.com'||u.protocol!=='https:')return null;const p=u.pathname.split('/').filter(Boolean);if(p.length<2||!p.slice(0,2).every(x=>/^[\w.-]+$/.test(x)))return null;return p.slice(0,2).join('/').replace(/\.git$/,'').toLowerCase()}catch{return null}
}
export function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!['localhost','127.0.0.1','::1'].includes(u.hostname)?u.href:null}catch{return null}}
export const text=(value,max=280)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';
export function identify(repo,url){return 'r-'+createHash('sha256').update(repo?'github:'+repo.toLowerCase():url).digest('hex').slice(0,16)}
export function classify(topics=[]){
 const s=topics.join(' ').toLowerCase();
 if(/mcp/.test(s))return 'MCP';if(/skill/.test(s))return 'Skill';if(/workflow|automation/.test(s))return 'Workflow';if(/harness|browser-agent/.test(s))return 'Harness';if(/framework|multi-agent/.test(s))return 'Framework';if(/plugin|extension/.test(s))return 'Plugin';if(/prompt|instruction|rule/.test(s))return 'Prompt / Rule';return 'Devtool / SDK';
}
export function repoRecord(r,source,at){
 const repo=githubRepo(r.html_url||r.url);if(!repo)return null;
 const stars=r.stargazers_count;return {id:identify(repo),repo,url:'https://github.com/'+repo,name:text(r.full_name?.split('/').at(-1)||repo.split('/')[1],100),summary:text(r.description),type:classify(r.topics||[]),classification:'按上游主题自动分类，未人工核验',tags:(r.topics||[]).filter(x=>typeof x==='string').slice(0,8),license:text(r.license?.spdx_id||r.license,60)||null,stars:Number.isInteger(stars)&&stars>=0?stars:null,updatedAt:r.pushed_at||null,version:null,archived:r.archived===true,status:r.archived?'archived':'active',checkedAt:at,descriptionOrigin:source,provenance:[{source,url:source==='GitHub'?'https://api.github.com/repos/'+repo:r.repository_url||r.url,checkedAt:at,license:source==='Ecosyste.ms'?DATA_LICENSE:'GitHub API terms'}],compatibility:[],security:'not-audited'};
}
export function registryRecord(entry,at){
 const r=entry.server,m=entry._meta?.['io.modelcontextprotocol.registry/official'];
 if(!r||typeof r.name!=='string'||typeof r.version!=='string'||!m||m.isLatest!==true)return null;
 const repo=githubRepo(r.repository?.url),sourceUrl=`https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(r.name)}/versions/${encodeURIComponent(r.version)}`;
 const packages=(r.packages||[]).filter(p=>['npm','pypi','oci','nuget'].includes(p.registryType)).map(p=>({registry:p.registryType,name:text(p.identifier,180),version:text(p.version,80),transport:text(p.transport?.type,50)}));
 const remotes=(r.remotes||[]).map(x=>({type:text(x.type,50),url:safeUrl(x.url)})).filter(x=>x.url);
 return {id:identify(repo,'mcp:'+r.name),repo,url:repo?'https://github.com/'+repo:sourceUrl,name:text(r.title||r.name,100),summary:text(r.description),type:'MCP',classification:'MCP 官方注册表类型；不代表安全审计',tags:['MCP'],license:null,stars:null,updatedAt:m.updatedAt||m.publishedAt||null,version:r.version,archived:false,status:m.status||'unknown',checkedAt:at,descriptionOrigin:'MCP Registry',provenance:[{source:'MCP Registry',url:sourceUrl,checkedAt:at,license:'上游元数据 · 原项目许可另查'}],compatibility:[],security:'not-audited',mcpServers:[{name:r.name,version:r.version,status:m.status,packages,remotes}]};
}
export function mergeRecord(a,b){
 if(!a)return b;const registry=b.provenance.some(p=>p.source==='MCP Registry');
 const mcp=new Map([...(a.mcpServers||[]),...(b.mcpServers||[])].map(s=>[s.name,s]));
 const provenance=new Map([...a.provenance,...b.provenance].map(p=>[p.source+'|'+p.url,p]));
 const merged={...a,...b,firstSeenAt:a.firstSeenAt||a.checkedAt,provenance:[...provenance.values()].slice(-12),mcpServers:[...mcp.values()]};
 if(registry){for(const k of ['stars','license','archived'])merged[k]=a[k]??b[k]}
 else if(mcp.size){merged.type='MCP';merged.version=[...mcp.values()].at(-1).version;merged.status=[...mcp.values()].some(s=>s.status==='active')?'active':[...mcp.values()].at(-1).status}
 return merged;
}
