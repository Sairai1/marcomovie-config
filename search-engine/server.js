/**
 * MarcoSearch: TVBox CMS-compatible aggregator.
 * Deploy this HTTP service to a Node 20+ host.
 * Does not store, stream, or proxy media files.
 */
import http from "node:http";
import {loadData,searchAcross,resolveDetails,homeData} from "./engine.js";
const PORT=Number(process.env.PORT||3000);
const ALLOWED_ORIGIN=process.env.CORS_ORIGIN||"*";
const TMDB_TOKEN=process.env.TMDB_READ_ACCESS_TOKEN||"";
const caches=new Map();
let busy=0;
const MAX_BUSY=Math.max(1,Math.min(25,Number(process.env.MAX_BUSY||8)));
const parseNumber=(s,fallback,min,max)=>{
  const n=Number(s);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;
};
const SOURCE_LIMIT=parseNumber(process.env.SEARCH_SOURCES,24,1,51);
const respond=(res,code,data,cacheSeconds=0)=>{
  res.writeHead(code,{"Content-Type":"application/json; charset=utf-8",
    "Cache-Control": cacheSeconds?"public, max-age="+cacheSeconds:"no-store",
    "Access-Control-Allow-Origin":ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods":"GET, OPTIONS",
    "X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(data));
};
function getCached(key){
  const saved=caches.get(key);if(!saved)return null;
  if(saved.expires<Date.now()){caches.delete(key);return null;}
  return saved.data;
}
function setCached(key,data,ms){
  if(caches.size>250)caches.delete(caches.keys().next().value);
  caches.set(key,{data,expires:Date.now()+ms});
}
const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS")return respond(res,200,{ok:true});
  if(req.method!=="GET")return respond(res,405,{code:0,msg:"GET only",list:[]});
  let url;
  try{url=new URL(req.url||"/","http://localhost");}catch{
    return respond(res,400,{code:0,msg:"Invalid request",list:[]});
  }
  if(url.pathname==="/health")return respond(res,200,{ok:true,version:"1.0.0",engine:"MarcoSearch"},30);
  if(url.pathname==="/")return respond(res,200,
    {code:1,msg:"MarcoSearch CMS",usage:"/api.php/provide/vod/?ac=videolist&wd=影片名",list:[]},30);
  if(!["/api.php/provide/vod","/api.php/provide/vod/"].includes(url.pathname)){
    return respond(res,404,{code:0,msg:"No route",list:[]});
  }
  const action=url.searchParams.get("ac")||"";
  if(!action)return respond(res,200,homeData(),300);
  if(!["videolist","list","detail"].includes(action)){
    return respond(res,400,{code:0,msg:"Unsupported action",list:[]});
  }
  if(busy>=MAX_BUSY)return respond(res,503,{code:0,msg:"Search engine busy",list:[]});
  const q=String(url.searchParams.get("wd")||"").trim().slice(0,100);
  const id=String(url.searchParams.get("ids")||"").trim();
  const key=action==="detail"?"d:"+id:"s:"+q.toLocaleLowerCase();
  const cached=getCached(key);
  if(cached)return respond(res,200,cached,30);
  if(action==="list"&&!q)return respond(res,200,homeData(),120);
  if(action==="videolist"&&!q)return respond(res,200,homeData(),120);
  if(action==="detail"&&!id)return respond(res,400,{code:0,msg:"ids required",list:[]});
  ++busy;
  try{
    const data=await loadData();
    let output;
    if(action==="detail"){
      const list=await resolveDetails(id,data);
      output={code:1,msg:list.length?"ok":"detail not available",list};
    }else{
      const result=await searchAcross(q,data,{limit:SOURCE_LIMIT,concurrency:8,
        timeoutMs:2600,maxTimeMs:10500,tmdbToken:TMDB_TOKEN});
      output={code:1,msg:"ok",list:result.list,page:1,pagecount:1,
        limit:result.list.length,total:result.list.length,
        diagnostic:{searched:result.searched,configured:result.configured,
          query_variants:result.variants,status:result.diagnostics}};
    }
    setCached(key,output,action==="detail"?600000:90000);
    return respond(res,200,output,15);
  }catch(err){
    console.error("engine_error",err?.message);
    return respond(res,502,{code:0,msg:"Upstream query failed",list:[]});
  }finally{--busy;}
});
server.listen(PORT,"0.0.0.0",()=>console.log("MarcoSearch listening on",PORT));
