import {loadData,search,details,home} from "./engine.js";

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
async function handle(request,env={}){
  if(request.method==="OPTIONS")return response({ok:true},200,600);
  if(request.method!=="GET"&&request.method!=="HEAD")return response({code:0,msg:"GET only",list:[]},405,0);
  const u=new URL(request.url);
  if(u.pathname==="/health")return response({ok:true,name:"MarcoSearch Workers",version:"1.0.1",runtime:"cloudflare"},200,30);
  if(u.pathname==="/")return response({code:1,msg:"MarcoSearch CMS",api:"/api.php/provide/vod/",list:[]},200,60);
  if(!["/api.php/provide/vod","/api.php/provide/vod/"].includes(u.pathname))
    return response({code:0,msg:"No route",list:[]},404,0);
  const ac=u.searchParams.get("ac")||"";
  const keyword=String(u.searchParams.get("wd")||"").trim().slice(0,90);
  const movieId=String(u.searchParams.get("ids")||"").trim().slice(0,2900);
  const pg=asNumber(u.searchParams.get("pg"),1,1,20);
  const hasDetail=!!movieId&&(ac==="detail"||ac==="videolist");
  // Marco Movie may send ac=detail&wd=title for standard CMS type 1.
  const hasSearch=!!keyword&&["detail","videolist","list"].includes(ac);
  if(!hasDetail&&!hasSearch)return response(home(),200,120);
  const key=hasDetail?"detail:"+movieId:"q:"+keyword.toLowerCase()+":"+pg;
  const hit=fromMemory(key);
  if(hit)return response(hit,200,20);
  try{
    const data=await loadData();
    let output;
    if(hasDetail){
      const list=await details(movieId,data);
      output={code:1,msg:list.length?"ok":"detail unavailable",list,page:1,pagecount:1,limit:list.length,total:list.length};
    }else{
      const result=await search(keyword,pg,data,{
        limit:asNumber(env.SEARCH_SOURCES,16,1,20),
        concurrency:asNumber(env.SEARCH_CONCURRENCY,4,1,4),
        timeout:asNumber(env.UPSTREAM_TIMEOUT_MS,2400,1000,3500),
        tmdbToken:env.TMDB_READ_ACCESS_TOKEN||""
      });
      output={code:1,msg:"ok",list:result.list,page:result.page,
        pagecount:result.pagecount,limit:result.list.length,total:result.list.length,
        search_info:{scanned:result.sourceCount,matched:result.matchCount,
          total_sources:data.sites.length,config_source:data.configSource,source_page:result.page,
          source_pages:result.pagecount}};
    }
    toMemory(key,output,hasDetail?180000:75000);
    return response(output,200,20);
  }catch(err){
    console.error("MarcoSearch upstream failure:",String(err?.message||"unknown").slice(0,180));
    return response({code:0,msg:"Upstream catalogue temporarily unavailable",list:[]},502,0);
  }
}
export {handle};
export default {fetch:handle};
