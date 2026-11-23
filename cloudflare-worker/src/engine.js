/*
 * MarcoSearch Cloudflare Workers edition.
 * Dynamic federated CMS catalog search; no video hosting or media proxy.
 * Browser/Workers Web APIs only. No Node built-ins.
 */
import {snapshotSites,snapshotFilms} from "./snapshot.js";
const CONFIG_URL="https://raw.githubusercontent.com/Sairai1/marcomovie-config/main/all.json";
const CATALOG_URL="https://raw.githubusercontent.com/Sairai1/marcomovie-config/main/catalogs/cult-films.json";
let configMemo=null;
const normal=(s)=>String(s??"").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu,"");
export {normal as normalize};

export function safeSite(site){
  if(!site||Number(site.type)!==1||Number(site.searchable)===0||typeof site.api!=="string")return false;
  try{
    const u=new URL(site.api);
    return u.protocol==="https:"&&!u.username&&!u.password&&!u.port
      &&u.hostname.includes(".")&&!/^(?:\d+\.){3}\d+$/.test(u.hostname)
      &&/^[a-z0-9.-]+$/i.test(u.hostname)
      &&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)
      &&u.hostname!=="raw.githubusercontent.com"&&!/^marco_(?:search|discover)(?:_|$)/.test(String(site.key));
  }catch{return false;}
}
function timeoutPromise(ms){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),ms);
  return {signal:ctrl.signal,clear:()=>clearTimeout(timer)};
}
async function fetchText(url,fetcher,timeout,maxBytes=900000){
  const a=timeoutPromise(timeout);
  try{
    const response=await fetcher(url,{signal:a.signal,redirect:"manual",headers:{Accept:"application/json, text/xml, */*"}});
    if(!response.ok)throw Error("http_"+response.status);
    if(Number(response.headers?.get("content-length")||0)>maxBytes)throw Error("too_large");
    const value=await response.text();
    if(value.length>maxBytes)throw Error("too_large");
    return value;
  }finally{a.clear();}
}
export async function loadData(fetcher=fetch,options={}){
  const now=Date.now();
  if(!options.noCache&&configMemo&&configMemo.expire>now)return configMemo.data;
  const configUrl=options.configUrl||CONFIG_URL;
  const catalogUrl=options.catalogUrl||CATALOG_URL;
  let cfg,films,configSource="live";
  try{
    const [raw,catalog]=await Promise.all([
      fetchText(configUrl,fetcher,3500,250000),
      fetchText(catalogUrl,fetcher,3500,250000).catch(()=>"{\"films\":[]}")
    ]);
    cfg=JSON.parse(raw);
    if(!Array.isArray(cfg.sites))throw new Error("invalid CMS sources");
    films=JSON.parse(catalog)?.films||snapshotFilms;
  }catch(err){
    if(options.noCache)throw err; // injectable tests validate live-path failures.
    cfg={sites:snapshotSites};
    films=snapshotFilms;
    configSource="bundled_fallback";
  }
  const sites=(cfg.sites||[]).filter(safeSite);
  const aliases=new Map(),canonical=new Map();
  for(const f of films){
    const names=[f.title_cn,f.title_en,f.title_ja,...(f.aliases||[])].filter(x=>typeof x==="string"&&x.trim());
    for(const n of names){
      const key=normal(n);
      if(key&&!aliases.has(key))aliases.set(key,names);
      if(key&&!canonical.has(key))canonical.set(key,f.id);
    }
  }
  const data={sites,aliases,canonical,configSource};
  if(!options.noCache)configMemo={data,expire:now+180000};
  return data;
}
export function expandTerms(query,aliases,extra=[]){
  const q=String(query??"").trim().slice(0,90);
  if(!q)return [];
  const out=[q],seen=new Set([normal(q)]);
  const found=aliases.get(normal(q))||[];
  // Group queries need alternate script spellings, not just exact film aliases.
  const series= /^(豚鼠|豚鼠系列|豚鼠六部曲|豚鼠全系列|guineapig|guineapigseries|ギニーピッグ)$/u.test(normal(q));
  const seriesTerms=series?["Guinea Pig","ギニーピッグ"]:[];
  for(const name of [...found,...seriesTerms,...extra]){
    if(typeof name!=="string"||name.length>100)continue;
    const key=normal(name);
    if(key&&!seen.has(key)){out.push(name);seen.add(key);}
  }
  return out.slice(0,3);
}
export async function tmdbAliases(query,token,fetcher=fetch){
  if(!token)return [];
  const params=new URLSearchParams({query,language:"zh-TW",include_adult:"true",page:"1"});
  const a=timeoutPromise(2000);
  try{
    const r=await fetcher("https://api.themoviedb.org/3/search/movie?"+params,{
      signal:a.signal,redirect:"manual",headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    if(!r.ok)return [];
    const json=await r.json();
    return (json.results||[]).slice(0,2).flatMap(x=>[x.original_title,x.title]).filter(Boolean);
  }catch{return [];}finally{a.clear();}
}
export function parseCms(body){
  if(typeof body!=="string"||body.length>900000)return [];
  const text=body.trim();
  if(text.startsWith("{")||text.startsWith("[")){
    let doc;
    try{doc=JSON.parse(text);}catch{return [];}
    let list=Array.isArray(doc)?doc:(doc.list||doc.data||doc.vod_list||[]);
    if(!Array.isArray(list))list=list?.list||[];
    if(!Array.isArray(list))return [];
    return list.filter(v=>v&&typeof v==="object"&&v.vod_id!=null&&v.vod_name)
      .slice(0,70).map(x=>({...x,vod_id:String(x.vod_id),vod_name:String(x.vod_name)}));
  }
  // Small XML CMS compatibility layer. It parses video/id/name and basic metadata,
  // but does not parse arbitrary XML schemas or XML playback playlists.
  if(!/^<\?xml|^<rss\b|^<list\b/i.test(text))return [];
  const out=[];
  const unescape=s=>s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  const val=(chunk,tag)=>unescape((chunk.match(new RegExp("<"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+tag+">","i"))||[])[1]||"").replace(/<[^>]*>/g,"").trim();
  for(const match of text.matchAll(/<video(?:\s[^>]*)?>([\s\S]*?)<\/video>/gi)){
    const chunk=match[1],id=val(chunk,"id")||val(chunk,"vod_id"),name=val(chunk,"name")||val(chunk,"vod_name");
    if(id&&name)out.push({vod_id:id,vod_name:name,vod_pic:val(chunk,"pic"),vod_year:val(chunk,"year")});
    if(out.length>=70)break;
  }
  return out;
}
function sourceQuery(site,term,action){
  const url=new URL(site.api);
  url.searchParams.set("ac",action);
  url.searchParams.set("wd",term);
  url.searchParams.set("pg","1");
  return url.toString();
}
function titleRelevant(item,terms){
  // Some CMS APIs silently ignore wd and return their latest listings. Never
  // misrepresent an unfiltered home feed as a result for the requested title.
  const title=normal([item.vod_name,item.vod_sub,item.vod_en].filter(Boolean).join(" "));
  const rawTitle=String(item.vod_name||"");
  if(!title)return false;
  const requestedJapaneseGuinea=terms.some(t=>{
    const n=normal(t);
    return ["豚鼠","豚鼠系列","豚鼠全系列","豚鼠六部曲","guineapig","ギニーピッグ"].includes(n)
      ||snapshotFilms.slice(0,6).some(f=>[f.title_cn,f.title_en,f.title_ja,...(f.aliases||[])].some(a=>normal(a)===n));
  });
  // American Guinea Pig and Slaughter Special are different works, not a
  // main-film match; never count them toward the original Japanese six.
  if(requestedJapaneseGuinea&&/(?:美国豚鼠|美國豚鼠|americanguineapig|豚鼠特攻队|豚鼠特攻隊|gforce|惨杀特别篇|慘殺特別篇|slaughterspecial)/iu.test(normal(rawTitle)))return false;
  if(/(?:电影解说|電影解說|影视解说|影視解說|影评|影評)/u.test(rawTitle)
    &&!terms.some(t=>/解说|解說|影评|影評/u.test(t)))return false;
  const series=terms.some(t=>/^(豚鼠|豚鼠系列|豚鼠六部曲|豚鼠全系列|guineapig|guineapigseries|ギニーピッグ)$/u.test(normal(t)));
  if(series){
    if(/(?:豚鼠特攻队|豚鼠特攻隊|美国豚鼠|美國豚鼠|americanguineapig|gforce)/iu.test(title))return false;
    // Match the Japanese films, but not unrelated works with the animal's name.
    return ["豚鼠系列","豚鼠恶魔","豚鼠血肉","ギニーピッグ","guineapig",
      "恶魔实验","血肉之花","他不会死","下水道的美人鱼","圣母机器人","恶魔女医生"]
      .some(t=>title.includes(normal(t)));
  }
  return terms.some(t=>{
    const n=normal(t);
    // Tiny one-character queries otherwise match far too many unrelated films.
    return n.length>=2&&title.includes(n);
  });
}
export async function cmsSearch(site,terms,fetcher=fetch,timeout=2400){
  // Maximum two upstream requests per site; protects Workers Free quota.
  // On many CMSs ac=detail&wd is a full-feed endpoint that ignores wd.
  // Verify that titles actually match and then retry ac=videolist when needed.
  const series=terms.some(t=>/^(豚鼠|豚鼠系列|豚鼠六部曲|豚鼠全系列|guineapig|ギニーピッグ)$/u.test(normal(t)));
  const strategy=[{term:terms[0],ac:"detail"},
    {term:series&&terms.length>1?terms[1]:terms[0],ac:series?"detail":"videolist"}];
  let status="empty",list=[];
  for(const part of strategy){
    try{
      const raw=await fetchText(sourceQuery(site,part.term,part.ac),fetcher,timeout);
      const parsed=parseCms(raw);
      const relevant=parsed.filter(item=>titleRelevant(item,terms));
      status=parsed.length&&!relevant.length?"ignored_keyword":"ok";
      list.push(...relevant);
      if(list.length&&!series)break;
    }catch(e){status=String(e?.message||"network_error").slice(0,40);}
  }
  const seen=new Set();
  list=list.filter(x=>{const key=x.vod_id+":"+x.vod_name;if(seen.has(key))return false;seen.add(key);return true;});
  return {site,items:list,status};
}
function toBase64(text){
  const bytes=new TextEncoder().encode(text);
  let binary="";for(const x of bytes)binary+=String.fromCharCode(x);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromBase64(b64){
  const padded=b64.replace(/-/g,"+").replace(/_/g,"/");
  const bin=atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0)));
}
export function encodeId(refs){return "msw1_"+toBase64(JSON.stringify(refs.slice(0,5)));}
export function decodeId(encoded){
  if(typeof encoded!=="string"||!encoded.startsWith("msw1_")||encoded.length>2900)return [];
  try{
    const items=JSON.parse(fromBase64(encoded.slice(5)));
    if(!Array.isArray(items)||items.length>5)return [];
    return items.filter(x=>x&&typeof x.k==="string"&&/^[a-zA-Z0-9_:-]+$/.test(x.k)
      &&typeof x.id==="string"&&x.id.length<512);
  }catch{return [];}
}
export function mergeResults(matches,term,canonical,max=100){
  const groups=new Map(),wanted=normal(term);
  for(const {site,item} of matches){
    const raw=normal(item.vod_name);
    if(!raw||!item.vod_id)continue;
    const year=String(item.vod_year||"").match(/\b(?:19|20)\d{2}\b/)?.[0]||"";
    const key=(canonical.get(raw)||raw)+"|"+year;
    if(!groups.has(key))groups.set(key,{movie:{...item},providers:[],refs:[]});
    const group=groups.get(key);
    if(group.refs.length<5){
      group.refs.push({k:site.key,id:String(item.vod_id)});
      group.providers.push(site.name||site.key);
    }
  }
  return [...groups.values()].map(g=>{
    const title=normal(g.movie.vod_name);
    const score=(title===wanted?100:(title.includes(wanted)||wanted.includes(title)?40:0))+g.providers.length*5;
    // Only return lightweight catalogue fields. Full playback/description
    // data is fetched via ac=detail&ids, keeping search responses small.
    const keep=["vod_name","vod_sub","vod_pic","vod_year","vod_remarks","vod_actor",
      "vod_director","vod_class","vod_area","vod_lang","vod_score","type_name"];
    const data={vod_id:encodeId(g.refs)};
    for(const name of keep)if(g.movie[name]!==undefined)data[name]=g.movie[name];
    data.vod_remarks=(g.providers.length+" 个来源 · "+(g.movie.vod_remarks||"")).slice(0,90);
    return {data,score};
  }).sort((a,b)=>b.score-a.score).slice(0,max).map(x=>x.data);
}
export async function search(term,page,data,opts={}){
  const fetcher=opts.fetcher||fetch;
  const limit=Math.max(1,Math.min(20,Number(opts.limit)||16));
  const concurrency=Math.max(1,Math.min(4,Number(opts.concurrency)||4));
  const sites=[...data.sites].sort((a,b)=>(Number(b.quickSearch)||0)-(Number(a.quickSearch)||0));
  const pages=Math.max(1,Math.ceil(sites.length/limit));
  const p=Math.max(1,Math.min(pages,Number(page)||1));
  const chosen=sites.slice((p-1)*limit,p*limit);
  const extras=await tmdbAliases(term,opts.tmdbToken,fetcher);
  const terms=expandTerms(term,data.aliases,extras);
  let i=0;
  const matches=[],diagnostics=[];
  const deadline=Date.now()+10000;
  async function worker(){
    while(i<chosen.length&&Date.now()<deadline){
      const site=chosen[i++];
      const outcome=await cmsSearch(site,terms,fetcher,Math.min(2600,Number(opts.timeout)||2400));
      for(const item of outcome.items)matches.push({site,item});
      diagnostics.push({site:site.key,status:outcome.status,count:outcome.items.length});
    }
  }
  await Promise.all(Array.from({length:Math.min(chosen.length,concurrency)},()=>worker()));
  return {list:mergeResults(matches,term,data.canonical),
    page:p,pagecount:pages,sourceCount:diagnostics.length,
    matchCount:matches.length,diagnostics};
}
export async function details(encoded,data,fetcher=fetch){
  const refs=decodeId(encoded);
  const sites=new Map(data.sites.map(s=>[s.key,s]));
  const obtained=await Promise.all(refs.map(async ref=>{
    const site=sites.get(ref.k);if(!site)return null;
    const url=new URL(site.api);
    url.searchParams.set("ac","detail");
    url.searchParams.set("ids",ref.id);
    try{
      const list=parseCms(await fetchText(url.toString(),fetcher,3400));
      const found=list.find(x=>x.vod_id===ref.id)||list[0];
      return found?{site,item:found}:null;
    }catch{return null;}
  }));
  const valid=obtained.filter(Boolean);if(!valid.length)return [];
  const froms=[],urls=[];
  for(const {site,item} of valid){
    const names=String(item.vod_play_from||"").split("$$$");
    const plays=String(item.vod_play_url||"").split("$$$");
    for(let i=0;i<plays.length;i++){
      if(!plays[i]||!plays[i].includes("$"))continue;
      froms.push((site.name||site.key).slice(0,30)+" · "+(names[i]||"线"+(i+1)));
      urls.push(plays[i]);
    }
  }
  return [{...valid[0].item,vod_id:encoded,vod_play_from:froms.join("$$$"),
    vod_play_url:urls.join("$$$"),vod_remarks:valid.length+" 个来源"}];
}
export function home(){
  return {code:1,msg:"MarcoSearch Workers — 搜索任何影视标题",
    class:[{type_id:"1",type_name:"聚合电影"},{type_id:"2",type_name:"聚合剧集"},
      {type_id:"3",type_name:"聚合动漫"}],list:[],page:1,pagecount:1,limit:0,total:0};
}
