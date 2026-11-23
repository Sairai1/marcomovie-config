/**
 * Independent global film/TV discovery providers (not streaming sources).
 * Wikidata (CC0), Apple iTunes catalog, TVmaze; optional TMDB bearer token.
 * No fake playback URLs, no scraped SERPs, no local film catalog impersonation.
 */
import {normalize,expandTerms} from "./engine.js";

const asStr=(x)=>String(x??"").trim();
const isMediaDescription=s=>/film|movie|cinema|television|tv series|telefilm|anime|animated|horror film|电影|電影|影片|动画|動畫|电视剧|電視劇|電視影集|影集|映画|アニメ|テレビドラマ|テレビ番組|劇場版|ビデオ|映像作品|video film|特撮/i.test(s);
const escapeHtml=s=>asStr(s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const idOf=(source,id)=>"md1_"+source+"_"+encodeURIComponent(asStr(id));
export function unpackId(id){
  const m=/^md1_(wd|apple|tvmaze|tmdb)_([a-zA-Z0-9%_-]{1,120})$/.exec(asStr(id));
  if(!m)return null;
  const val=decodeURIComponent(m[2]);
  if(m[1]==="wd"&&!/^Q\d+$/.test(val))return null;
  if(m[1]!=="wd"&&!/^\d+$/.test(val))return null;
  return {provider:m[1],id:val};
}
function scoreTitle(t,names){
  const target=normalize(t);
  if(target.length<2)return 0;
  let score=0;
  for(const n of names){
    const a=normalize(n);
    if(!a)continue;
    if(a===target)score=Math.max(score,100);
    else if(a.includes(target)&&target.length>=3)score=Math.max(score,55);
    else if(target.includes(a)&&a.length>=4)score=Math.max(score,35);
  }
  return score;
}
function mkRow(provider,id,title,year,sourceUrl,description="",aliases=[]){
  const name=asStr(title).slice(0,170);
  if(!name||!sourceUrl)return null;
  return {provider,id:asStr(id),title:name,year:asStr(year).slice(0,4),
    sourceUrl,description:asStr(description).slice(0,600),aliases:aliases.filter(Boolean).map(asStr)};
}
function sourceLink(row){
  const e=escapeHtml;
  return "<p>此条目来自 <b>"+e(row.provider)+"</b> 的公开影视资料搜索，"
    +"不代表已收录可播放的完整影片。</p>"
    +"<p>"+e(row.description||"暂无简介")+"</p>"
    +"<p>原始资料：<a href=\""+e(row.sourceUrl)+"\">"+e(row.sourceUrl)+"</a></p>";
}
function vodFrom(row,providers=[row.provider]){
  return {vod_id:idOf(row.provider,row.id),vod_name:row.title,
    vod_year:row.year||"",vod_pic:"",
    vod_remarks:"影视资料 · "+providers.join("+")+" · 非播放源",
    vod_blurb:row.description,
    vod_content:sourceLink(row),vod_play_from:"",vod_play_url:"",vod_douban_id:0};
}
async function getJson(url,fetcher=fetch,timeout=2800,extraHeaders={}){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),timeout);
  try{
    const r=await fetcher(url,{signal:ctrl.signal,redirect:"manual",
      headers:{"accept":"application/json","user-agent":"MarcoSearch-Discover/1.0 (https://github.com/Sairai1/marcomovie-config)",...extraHeaders}});
    if(!r.ok)throw Error("HTTP_"+r.status);
    if(Number(r.headers?.get("content-length")||0)>550000)throw Error("large");
    const text=await r.text();
    if(text.length>550000)throw Error("large");
    return JSON.parse(text);
  }finally{clearTimeout(t);}
}
export async function queryWikidata(term,language="en",fetcher=fetch){
  const url=new URL("https://www.wikidata.org/w/api.php");
  for(const [k,v] of Object.entries({action:"wbsearchentities",format:"json",type:"item",language,uselang:language,search:term,limit:"16"}))
    url.searchParams.set(k,v);
  const d=await getJson(url.toString(),fetcher);
  return (d.search||[]).flatMap(x=>{
    const desc=asStr(x.description);
    // Media information only: do not create 'guinea pig' animal pages.
    if(!isMediaDescription(desc))return [];
    const id=asStr(x.id);
    if(!/^Q\d+$/.test(id))return [];
    const row=mkRow("wd",id,x.label,"","https://www.wikidata.org/wiki/"+id,desc,
      [x.label,x.match?.text]);
    return row?[row]:[];
  });
}
export async function queryApple(term,country="US",fetcher=fetch){
  const url=new URL("https://itunes.apple.com/search");
  for(const [k,v] of Object.entries({term,media:"movie",entity:"movie",limit:"25",country}))
    url.searchParams.set(k,v);
  const d=await getJson(url.toString(),fetcher);
  return (d.results||[]).flatMap(x=>{
    if(!x.trackId||!x.trackName||!(x.kind==="feature-movie"||x.wrapperType==="track"))return [];
    // The Apple catalog is metadata only, not a streaming API.
    const row=mkRow("apple",x.trackId,x.trackName,
      asStr(x.releaseDate).slice(0,4),
      x.trackViewUrl||"https://itunes.apple.com/lookup?id="+encodeURIComponent(x.trackId),
      x.longDescription||x.shortDescription||"",[x.trackName]);
    return row?[row]:[];
  });
}
export async function queryTVmaze(term,fetcher=fetch){
  const url="https://api.tvmaze.com/search/shows?q="+encodeURIComponent(term);
  const d=await getJson(url,fetcher);
  return (Array.isArray(d)?d:[]).flatMap(x=>{
    const show=x.show;
    if(!show?.id||!show?.name)return [];
    const row=mkRow("tvmaze",show.id,show.name,
      asStr(show.premiered).slice(0,4),
      show.url||"https://www.tvmaze.com/shows/"+show.id,
      asStr(show.summary).replace(/<[^>]+>/g,"").slice(0,500),[show.name]);
    return row?[row]:[];
  });
}
export async function queryTMDB(term,token,fetcher=fetch){
  if(!token)return [];
  const url="https://api.themoviedb.org/3/search/multi?"+new URLSearchParams({
    query:term,include_adult:"true",language:"en-US",page:"1"});
  const d=await getJson(url,fetcher,2800,{authorization:"Bearer "+token});
  return (d.results||[]).flatMap(x=>{
    if(!["movie","tv"].includes(x.media_type)||!x.id)return [];
    const title=x.title||x.name;
    const url="https://www.themoviedb.org/"+x.media_type+"/"+x.id;
    const row=mkRow("tmdb",x.id,title,
      asStr(x.release_date||x.first_air_date).slice(0,4),url,x.overview||"",
      [x.title,x.name,x.original_title,x.original_name]);
    return row?[row]:[];
  });
}
export async function discoverSearch(query,data={},opts={}){
  const fetcher=opts.fetcher||fetch;
  const aliases=data.aliases||new Map();
  const terms=expandTerms(query,aliases);
  const main=terms[0]||query;
  const english=terms.find(t=>/[a-zA-Z]{3}/.test(t))||main;
  const japanese=terms.find(t=>/[\u3040-\u30ff]/.test(t))||main;
  const jobs=[
    ["Wikidata 中文",()=>queryWikidata(main,"zh",fetcher)],
    ["Wikidata 英文",()=>queryWikidata(english,"en",fetcher)],
    ["Wikidata 日文",()=>queryWikidata(japanese,"ja",fetcher)],
    ["Apple 美国",()=>queryApple(english,"US",fetcher)],
    ["Apple 日本",()=>queryApple(japanese,"JP",fetcher)],
    ["TVmaze 剧集",()=>queryTVmaze(english,fetcher)]
  ];
  if(opts.tmdbToken)jobs.push(["TMDB",()=>queryTMDB(english,opts.tmdbToken,fetcher)]);
  // Six or seven requests (far below free-tier 50/request); max 4 concurrent.
  const diagnostics=[];
  const found=[];
  let next=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(next<jobs.length){
      const [name,doQuery]=jobs[next++];
      try{
        const rows=await doQuery();
        diagnostics.push({provider:name,status:"ok",count:rows.length});
        found.push(...rows);
      }catch(e){diagnostics.push({provider:name,status:asStr(e?.message||"failed").slice(0,60),count:0});}
    }
  }));
  const grouped=new Map();
  for(const row of found){
    const relevance=Math.max(...[row.title,...row.aliases].map(t=>scoreTitle(t,terms)));
    if(relevance<35)continue;
    const key=normalize(row.title)+"|"+row.year;
    if(!grouped.has(key))grouped.set(key,{row,providers:[],score:relevance});
    const g=grouped.get(key);
    if(!g.providers.includes(row.provider))g.providers.push(row.provider);
    g.score=Math.max(g.score,relevance);
  }
  const list=[...grouped.values()].sort((a,b)=>b.score-a.score||
    b.providers.length-a.providers.length).slice(0,60)
    .map(g=>vodFrom(g.row,g.providers));
  return {list,diagnostics,engines:jobs.length};
}
export async function discoverDetail(encoded,fetcher=fetch,token=""){
  const parsed=unpackId(encoded);
  if(!parsed)return [];
  const {provider,id}=parsed;
  let row=null;
  try{
    if(provider==="wd"){
      const api="https://www.wikidata.org/wiki/Special:EntityData/"+id+".json";
      const d=await getJson(api,fetcher);
      const e=d.entities?.[id]||{};
      const label=e.labels?.zh?.value||e.labels?.en?.value||e.labels?.ja?.value||id;
      const desc=e.descriptions?.zh?.value||e.descriptions?.en?.value||"";
      row=mkRow("wd",id,label,"","https://www.wikidata.org/wiki/"+id,desc);
    }else if(provider==="apple"){
      const d=await getJson("https://itunes.apple.com/lookup?"+new URLSearchParams({id,country:"US"}),fetcher);
      const x=d.results?.[0];
      if(x)row=mkRow("apple",id,x.trackName,asStr(x.releaseDate).slice(0,4),
        x.trackViewUrl||"https://itunes.apple.com/lookup?id="+id,x.longDescription||x.shortDescription||"");
    }else if(provider==="tvmaze"){
      const x=await getJson("https://api.tvmaze.com/shows/"+id,fetcher);
      row=mkRow("tvmaze",id,x.name,asStr(x.premiered).slice(0,4),
        x.url||"https://www.tvmaze.com/shows/"+id,
        asStr(x.summary).replace(/<[^>]+>/g,""));
    }else if(provider==="tmdb"&&token){
      const x=await getJson("https://api.themoviedb.org/3/movie/"+id,fetcher,2800,{authorization:"Bearer "+token});
      row=mkRow("tmdb",id,x.title,asStr(x.release_date).slice(0,4),
        "https://www.themoviedb.org/movie/"+id,x.overview);
    }
  }catch{return [];}
  return row?[vodFrom(row)]:[];
}
