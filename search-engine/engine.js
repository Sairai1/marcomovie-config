/**
 * Marco Search Engine v1 — runtime CMS federation for Marco Movie.
 * Pure ESM (Node 20+). No video hosting, bypass or hard-coded film matches.
 */
const CONFIG_URL = "https://raw.githubusercontent.com/Sairai1/marcomovie-config/main/all.json";
const CULT_URL = "https://raw.githubusercontent.com/Sairai1/marcomovie-config/main/catalogs/cult-films.json";
const cache = new Map();
export const endpoints = {config:CONFIG_URL, catalog:CULT_URL};
export function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu,"");
}
export function safeSource(s) {
  if (!s || Number(s.type)!==1 || Number(s.searchable)===0 || typeof s.api!=="string") return false;
  try {
    const u=new URL(s.api), host=u.hostname;
    if(u.protocol!=="https:"||u.username||u.password||u.port||!host.includes("."))return false;
    if(!/^[a-z0-9.-]+$/i.test(host)||/^(?:\d+\.){3}\d+$/.test(host))return false;
    if(/(^|\.)(localhost|local|internal|test|invalid)$/.test(host))return false;
    if(host==="raw.githubusercontent.com")return false;
    return true;
  }catch{return false;}
}
export function urlWith(base,args) {
  const u=new URL(base);
  for(const [k,v] of Object.entries(args))u.searchParams.set(k,String(v));
  return u.toString();
}
async function loadJson(url,fetcher){
  const old=cache.get(url);
  if(old&&Date.now()-old.time<180000)return old.data;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
  try {
    const r=await fetcher(url,{signal:controller.signal,redirect:"error",headers:{Accept:"application/json"}});
    if(!r.ok)throw Error("HTTP "+r.status);
    const body=await r.text();
    if(body.length>250000)throw Error("Too large");
    const data=JSON.parse(body);
    cache.set(url,{time:Date.now(),data});
    return data;
  }catch(e){if(old)return old.data;throw e;}
  finally{clearTimeout(timer);}
}
export async function loadData(fetcher=fetch,configUrl=CONFIG_URL,cultUrl=CULT_URL){
  const [cfg,cult]=await Promise.all([loadJson(configUrl,fetcher),loadJson(cultUrl,fetcher).catch(()=>({films:[]}))]);
  return {sites:(cfg.sites||[]).filter(s=>s.key!=="marco_search"&&safeSource(s)),films:cult.films||[]};
}
function variants(f){return [f.title_cn,f.title_en,f.title_ja,...(f.aliases||[])].filter(x=>typeof x==="string"&&x.trim());}
export function expandQuery(term,films,extra=[]){
  const input=String(term||"").trim().slice(0,100);if(!input)return [];
  const out=[input],q=normalize(input);
  for(const f of films){
    const names=variants(f);
    if(names.some(n=>normalize(n)===q)){
      for(const n of names){if(!out.some(x=>normalize(x)===normalize(n)))out.push(n);}
      break;
    }
  }
  for(const n of extra)if(typeof n==="string"&&n.length<100&&!out.some(x=>normalize(x)===normalize(n)))out.push(n);
  return out.slice(0,3);
}
export async function tmdbVariants(term,token,fetcher=fetch){
  if(!token)return [];
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),2000);
  try{
    const u=urlWith("https://api.themoviedb.org/3/search/movie",{query:term,language:"zh-TW",include_adult:"true",page:1});
    const r=await fetcher(u,{signal:abort.signal,redirect:"error",headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    if(!r.ok)return [];
    const j=await r.json();
    return (j.results||[]).slice(0,2).flatMap(x=>[x.title,x.original_title]).filter(Boolean);
  }catch{return [];}finally{clearTimeout(timer);}
}
export function cmsItems(payload){
  if(typeof payload!=="string"||payload.length>950000)return [];
  let j;try{j=JSON.parse(payload);}catch{return [];}
  let list=Array.isArray(j)?j:(j.list||j.data||j.vod_list||[]);
  if(!Array.isArray(list))list=list?.list||[];
  return Array.isArray(list)?list.filter(v=>v&&typeof v==="object"&&v.vod_id!=null&&v.vod_name).slice(0,60):[];
}
async function callCms(site,mode,term,fetcher,timeoutMs=2600){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs);
  const u=urlWith(site.api,mode==="detail"?{ac:"detail",ids:term}:{ac:"videolist",wd:term,pg:1});
  try{
    const r=await fetcher(u,{signal:abort.signal,redirect:"error",headers:{Accept:"application/json, text/plain, */*"}});
    if(!r.ok)return {status:"http_"+r.status,items:[]};
    if(Number(r.headers?.get("content-length")||0)>950000)return {status:"oversize",items:[]};
    return {status:"ok",items:cmsItems(await r.text())};
  }catch(e){return {status:e?.name==="AbortError"?"timeout":"network_error",items:[]};}
  finally{clearTimeout(timer);}
}
export function encodeId(refs){return "ms1_"+Buffer.from(JSON.stringify(refs.slice(0,5))).toString("base64url");}
export function decodeId(str){
  if(typeof str!=="string"||!str.startsWith("ms1_")||str.length>3000)return [];
  try{
    const rows=JSON.parse(Buffer.from(str.slice(4),"base64url").toString());
    if(!Array.isArray(rows)||rows.length>5)return [];
    return rows.filter(r=>r&&typeof r.k==="string"&&/^[a-zA-Z0-9_:-]+$/.test(r.k)
      &&typeof r.id==="string"&&r.id.length<512);
  }catch{return [];}
}
function canonical(title,films){
  const q=normalize(title);
  for(const f of films)if(variants(f).some(n=>normalize(n)===q))return f.id;
  return q;
}
export function mergeResults(rows,query,films,max=120){
  const grouped=new Map(),q=normalize(query);
  for(const {site,item} of rows){
    if(item.vod_id==null||!normalize(item.vod_name))continue;
    const year=String(item.vod_year||"").match(/\b(?:19|20)\d{2}\b/)?.[0]||"";
    const key=canonical(item.vod_name,films)+"|"+year;
    if(!grouped.has(key))grouped.set(key,{item:{...item},refs:[],providers:new Set()});
    const g=grouped.get(key);
    if(g.refs.length<5)g.refs.push({k:site.key,id:String(item.vod_id)});
    g.providers.add(site.name||site.key);
  }
  return [...grouped.values()].map(g=>{
    const n=normalize(g.item.vod_name),score=(n===q?100:(n.includes(q)||q.includes(n)?40:0))
      +Math.min(5,g.providers.size)*3;
    const out={...g.item,vod_id:encodeId(g.refs),
      vod_remarks:(String(g.providers.size)+" 来源 | "+(g.item.vod_remarks||"")).slice(0,90)};
    delete out.vod_play_url;delete out.vod_play_from;
    return {score,out};
  }).sort((a,b)=>b.score-a.score).slice(0,max).map(x=>x.out);
}
export async function searchAcross(term,data,{
 fetcher=fetch,limit=24,concurrency=10,timeoutMs=2600,maxTimeMs=10000,tmdbToken=""
}={}){
  const hash=[...term].reduce((v,c)=>(v*33+c.codePointAt(0))>>>0,5381);
  const fast=data.sites.filter(s=>s.quickSearch===1),slow=data.sites.filter(s=>s.quickSearch!==1);
  const rotate=a=>a.length?a.slice(hash%a.length).concat(a.slice(0,hash%a.length)):[];
  const chosen=[...rotate(fast),...rotate(slow)].slice(0,Math.max(1,Math.min(50,limit)));
  const extra=await tmdbVariants(term,tmdbToken,fetcher),terms=expandQuery(term,data.films,extra);
  const deadline=Date.now()+maxTimeMs,found=[],diagnostics=[];
  let pos=0;
  async function worker(){
    while(pos<chosen.length&&Date.now()<deadline){
      const site=chosen[pos++];let count=0,status="not_searched";
      for(const kw of terms.slice(0,terms.length>1?2:1)){
        if(Date.now()>deadline)break;
        const result=await callCms(site,"search",kw,fetcher,Math.max(200,Math.min(timeoutMs,deadline-Date.now())));
        status=result.status;
        for(const item of result.items){found.push({site,item});count++;}
        if(count)break;
      }
      diagnostics.push({name:site.name||site.key,status,matches:count});
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,chosen.length)},()=>worker()));
  return {list:mergeResults(found,term,data.films),searched:diagnostics.length,
   configured:data.sites.length,variants:terms,diagnostics};
}
export async function resolveDetails(encoded,data,{fetcher=fetch,timeoutMs=3600}={}){
  const sites=new Map(data.sites.map(s=>[s.key,s]));
  const responses=await Promise.all(decodeId(encoded).map(async ref=>{
    const site=sites.get(ref.k);if(!site)return null;
    const result=await callCms(site,"detail",ref.id,fetcher,timeoutMs);
    const item=result.items.find(x=>String(x.vod_id)===ref.id)||result.items[0];
    return item?{site,item}:null;
  }));
  const valid=responses.filter(Boolean);if(!valid.length)return [];
  const from=[],urls=[];
  for(const {site,item} of valid){
    const sources=String(item.vod_play_from||"").split("$$$");
    const groups=String(item.vod_play_url||"").split("$$$");
    for(let n=0;n<groups.length;n++){
      if(!groups[n]||!groups[n].includes("$"))continue;
      from.push((site.name||site.key).slice(0,24)+" · "+(sources[n]||"线路"));
      urls.push(groups[n]);
    }
  }
  return [{...valid[0].item,vod_id:encoded,vod_play_from:from.join("$$$"),
    vod_play_url:urls.join("$$$"),vod_remarks:"来源 "+valid.length}];
}
export function homeData(){
  return {code:1,msg:"MarcoSearch: 请在搜索框输入任意片名",
   class:[{type_id:"movie",type_name:"电影"},{type_id:"series",type_name:"电视剧"},
    {type_id:"anime",type_name:"动漫"}],list:[],page:1,pagecount:1,limit:0,total:0};
}
