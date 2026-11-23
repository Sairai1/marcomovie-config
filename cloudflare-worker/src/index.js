import {loadData,search,details,home} from "./engine.js";
import {discoverSearch,discoverDetail} from "./discovery.js";
import {archiveSearch,archiveDetail,panSouSearch,panSouDetail,watchmodeSearch,watchmodeDetail,externalHome} from "./external-engines.js";

const memory=new Map();
function response(data,status=200,ttl=30){
  return new Response(JSON.stringify(data),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":ttl?"public, max-age="+ttl:"no-store",
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"GET, HEAD, OPTIONS",
    "access-control-allow-headers":"Content-Type",
    "x-content-type-options":"nosniff"
  }});
}
function fromMemory(key){
  const value=memory.get(key);
  if(value&&value.until>Date.now())return value.data;
  memory.delete(key);
  return null;
}
function toMemory(key,data,ttl=60000){
  if(memory.size>=150)memory.delete(memory.keys().next().value);
  memory.set(key,{data,until:Date.now()+ttl});
}
const asNumber=(value,fallback,min,max)=>{
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;
};
const detailsResponse=list=>({
  code:1,msg:list.length?"ok":"detail unavailable",list,
  page:1,pagecount:1,limit:list.length,total:list.length
});
const searchResponse=(result,data,shard)=>{
  const isShard=!!shard;
  return {code:1,msg:"ok",list:result.list,
    page:result.page,pagecount:result.pagecount,
    limit:result.list.length,total:result.list.length,
    search_info:{scanned:result.sourceCount,matched:result.matchCount,
      total_sources:data.sites.length,config_source:data.configSource,
      search_shard:shard||0,source_page:result.page,
      source_pages:result.pagecount,source_diagnostics:result.diagnostics}};
};
const discoveryHome=()=>({code:1,msg:"MarcoDiscover — Wikidata, Apple 电影, TVmaze (资料检索，无内置播放)",
  class:[{type_id:"1",type_name:"全球电影资料"},{type_id:"2",type_name:"全球剧集资料"}],
  list:[],page:1,pagecount:1,limit:0,total:0});
async function handle(request,env={}){
  if(request.method==="OPTIONS")return response({ok:true},200,600);
  if(request.method!=="GET"&&request.method!=="HEAD")return response({code:0,msg:"GET only",list:[]},405,0);
  const u=new URL(request.url),path=u.pathname.replace(/\/$/,"");
  if(path==="/health")return response({ok:true,name:"MarcoSearch Workers",
    version:"1.2.0",runtime:"cloudflare",
    engines:["cms-aggregate","cms-shard-1","cms-shard-2","cms-shard-3",
      "wikidata","apple-itunes","tvmaze","tmdb-optional",
      "internet-archive","pansou-optional","watchmode-optional"]},200,30);
  if(path==="")return response({code:1,msg:"MarcoSearch CMS",
    api:"/api.php/provide/vod/",list:[]},200,60);
  const shardMatch=path.match(/^\/api\.php\/provide\/vod\/shard\/([123])$/);
  const isDiscover=path==="/api.php/discover/vod";
  const externalKind=({
    "/api.php/archive/vod":"archive",
    "/api.php/pansou/vod":"pansou",
    "/api.php/watchmode/vod":"watchmode"
  })[path]||"";
  const isCMS=path==="/api.php/provide/vod"||!!shardMatch;
  if(!isCMS&&!isDiscover&&!externalKind)return response({code:0,msg:"No route",list:[]},404,0);

  const ac=u.searchParams.get("ac")||"";
  const keyword=String(u.searchParams.get("wd")||"").trim().slice(0,90);
  const movieId=String(u.searchParams.get("ids")||"").trim().slice(0,2900);
  const pg=asNumber(u.searchParams.get("pg"),1,1,20);
  const shard=shardMatch?Number(shardMatch[1]):0;
  const hasDetail=!!movieId&&(ac==="detail"||ac==="videolist");
  const hasSearch=!!keyword&&["detail","videolist","list"].includes(ac);
  if(!hasDetail&&!hasSearch)return response(externalKind?externalHome(externalKind):
    isDiscover?discoveryHome():home(),200,120);

  const key=[externalKind|| (isDiscover?"discover":"cms"),shard,
    hasDetail?"detail:"+movieId:"q:"+keyword.toLowerCase()+":"+pg].join(":");
  const hit=fromMemory(key);
  if(hit)return response(hit,200,20);
  try{
    const data=await loadData();
    let output;
    if(externalKind){
      if(hasDetail){
        const list=externalKind==="archive"?await archiveDetail(movieId):
          externalKind==="pansou"?panSouDetail(movieId):
          await watchmodeDetail(movieId,env.WATCHMODE_API_KEY||"",env.WATCHMODE_REGIONS||"US");
        output=detailsResponse(list);
      }else{
        output=externalKind==="archive"?await archiveSearch(keyword,data.aliases):
          externalKind==="pansou"?await panSouSearch(keyword,env.PANSOU_API_URL||"",env.PANSOU_BEARER_TOKEN||""):
          await watchmodeSearch(keyword,env.WATCHMODE_API_KEY||"");
        if(externalKind==="watchmode"&&output.configured)toMemory(key,output,360000);
      }
    }else if(isDiscover){
      if(hasDetail){
        const list=await discoverDetail(movieId,fetch,env.TMDB_READ_ACCESS_TOKEN||"");
        output=detailsResponse(list);
      }else{
        const result=await discoverSearch(keyword,data,{fetcher:fetch,
          tmdbToken:env.TMDB_READ_ACCESS_TOKEN||""});
        output={code:1,msg:"ok",list:result.list,page:1,pagecount:1,
          limit:result.list.length,total:result.list.length,
          search_info:{kind:"metadata_only",engines:result.engines,
            source_diagnostics:result.diagnostics}};
      }
    }else if(hasDetail){
      output=detailsResponse(await details(movieId,data));
    }else{
      const sorted=[...data.sites].sort((a,b)=>(Number(b.quickSearch)||0)-(Number(a.quickSearch)||0));
      const selected=shard?sorted.slice((shard-1)*17,shard*17):data.sites;
      const subData=shard?{...data,sites:selected}:data;
      const result=await search(keyword,shard?1:pg,subData,{
        limit:shard?17:asNumber(env.SEARCH_SOURCES,16,1,20),
        concurrency:asNumber(env.SEARCH_CONCURRENCY,4,1,4),
        timeout:asNumber(env.UPSTREAM_TIMEOUT_MS,2400,1000,3500),
        tmdbToken:env.TMDB_READ_ACCESS_TOKEN||""
      });
      output=searchResponse(result,data,shard);
    }
    toMemory(key,output,hasDetail?180000:externalKind==="watchmode"?360000:75000);
    return response(output,200,20);
  }catch(err){
    console.error("MarcoSearch upstream failure:",String(err?.message||"unknown").slice(0,180));
    return response({code:0,msg:"Upstream catalogues temporarily unavailable",list:[]},502,0);
  }
}
export {handle};
export default {fetch:handle};
