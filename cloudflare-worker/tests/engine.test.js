import test from "node:test";
import assert from "node:assert/strict";
import {normalize,safeSite,expandTerms,parseCms,mergeResults,encodeId,decodeId,search,details,loadData} from "../src/engine.js";
import worker from "../src/index.js";

const film={id:"cult001",title_cn:"鐵男",title_en:"Tetsuo: The Iron Man",title_ja:"鉄男",aliases:["Tetsuo"]};
const aliases=new Map([["鐵男",["鐵男","Tetsuo: The Iron Man","鉄男"]]]);
const canonical=new Map([["鐵男","cult001"],["tetsuotheironman","cult001"]]);
const site=(key)=>({key,type:1,name:"测试-"+key,api:"https://"+key+".example.org/api.php/provide/vod/",searchable:1,quickSearch:1});
const sources=[site("first"),site("second"),site("third")];
const ok=payload=>new Response(JSON.stringify(payload),{headers:{"Content-Type":"application/json"}});

test("Unicode title normalization",()=>{
 assert.equal(normalize("Tetsuo: The Iron Man"),"tetsuotheironman");
 assert.equal(normalize("鉄 男"),"鉄男");
});
test("Restrict CMS to public HTTPS hosts",()=>{
 assert.equal(safeSite(sources[0]),true);
 assert.equal(safeSite({...sources[0],api:"http://first.example.org"}),false);
 assert.equal(safeSite({...sources[0],api:"https://127.0.0.1/"}),false);
 assert.equal(safeSite({...sources[0],api:"https://localhost/"}),false);
 assert.equal(safeSite({...sources[0],key:"marco_search"}),false);
});
test("Known film expands to other languages, unknown query is not blocked",()=>{
 assert.deepEqual(expandTerms("鐵男",aliases),["鐵男","Tetsuo: The Iron Man","鉄男"]);
 assert.deepEqual(expandTerms("全新冷門片",aliases),["全新冷門片"]);
});
test("CMS JSON and XML list parsing",()=>{
 assert.equal(parseCms(JSON.stringify({list:[{vod_id:12,vod_name:"鐵男"}]})).length,1);
 assert.equal(parseCms('<?xml version="1.0"?><rss><list><video><id>11</id><name>鐵男</name></video></list></rss>')[0].vod_id,"11");
 assert.deepEqual(parseCms("garbage"),[]);
});
test("Encoded Worker IDs support Unicode and reject arbitrary inputs",()=>{
 const id=encodeId([{k:"first",id:"铁男_01"}]);
 assert.deepEqual(decodeId(id),[{k:"first",id:"铁男_01"}]);
 assert.deepEqual(decodeId("msw1_fake"),[]);
});
test("Merge duplicates by canonical alias and year",()=>{
 const data=mergeResults([
 {site:sources[0],item:{vod_id:"1",vod_name:"鐵男",vod_year:"1989"}},
 {site:sources[1],item:{vod_id:"2",vod_name:"Tetsuo: The Iron Man",vod_year:"1989"}}
 ],"鐵男",canonical);
 assert.equal(data.length,1);
 assert.equal(decodeId(data[0].vod_id).length,2);
});
test("Search executes live CMS lookups and reports source pages",async()=>{
 let calls=0;
 const fetcher=async(url)=>{
  ++calls;
  const host=new URL(url).hostname;
  const id=host.split(".")[0];
  return ok({list:[{vod_id:id,vod_name:"鐵男",vod_year:"1989"}]});
 };
 const data={sites:sources,aliases,canonical};
 const result=await search("鐵男",1,data,{fetcher,limit:2,concurrency:2});
 assert.equal(result.pagecount,2);
 assert.equal(result.sourceCount,2);
 assert.equal(result.list.length,1);
 assert.equal(decodeId(result.list[0].vod_id).length,2);
 const page2=await search("鐵男",2,data,{fetcher,limit:2,concurrency:1});
 assert.equal(page2.sourceCount,1);
 assert.equal(page2.list.length,1);
 assert.equal(calls,3);
});
test("Standard CMS fallback attempts ac=videolist if ac=detail returned empty",async()=>{
 let calls=0;
 const fetcher=async (url,opts)=>{
  assert.equal(opts.redirect,"manual");
  ++calls;
  return ok({list:new URL(url).searchParams.get("ac")==="videolist"?
    [{vod_id:"123",vod_name:"未知新电影"}]:[]});
 };
 const found=await search("未知新电影",1,{sites:sources.slice(0,1),
  aliases:new Map(),canonical:new Map()},{fetcher,limit:1});
 assert.equal(calls,2);
 assert.equal(found.list.length,1);
});
test("Detail loads original playback URL without proxying media",async()=>{
 const id=encodeId([{k:"first",id:"alpha"}]);
 const fetcher=async()=>ok({list:[{vod_id:"alpha",vod_name:"鐵男",vod_play_from:"本人媒体",
    vod_play_url:"正片$https://first.example.org/video.mp4"}]});
 const found=await details(id,{sites:sources},fetcher);
 assert.equal(found.length,1);
 assert.match(found[0].vod_play_url,/first.example.org\/video.mp4/);
});
test("Load config removes circular self-source",async()=>{
 const config={sites:[site("first"),{...site("second"),key:"marco_search"}]};
 const mock=async (url,opts)=>{assert.equal(opts.redirect,"manual");return ok(url.endsWith("all.json")?config:{films:[film]});};
 const data=await loadData(mock,{noCache:true,configUrl:"https://example.org/all.json",
   catalogUrl:"https://example.org/cult.json"});
 assert.equal(data.sites.length,1);
 assert(data.aliases.has("鐵男"));
});
test("Worker router recognizes ac=detail&wd as a search request",async()=>{
 const original=globalThis.fetch;
 const config={sites:[site("first")]};
 globalThis.fetch=async url=>{
  if(String(url).endsWith("/all.json"))return ok(config);
  if(String(url).endsWith("/cult-films.json"))return ok({films:[film]});
  if(String(url).includes("first.example.org"))return ok({list:[{vod_id:1,vod_name:"鐵男"}]});
  throw new Error("unexpected request "+String(url));
 };
 try {
  const response=await worker.fetch(new Request("https://unit.test/api.php/provide/vod/?ac=detail&wd=%E9%90%B5%E7%94%B7"),{
   SEARCH_SOURCES:"1",SEARCH_CONCURRENCY:"1"
  });
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.list.length,1);
 }finally{globalThis.fetch=original;}
});
test("Worker health requires no configured CMS or network",async()=>{
 const r=await worker.fetch(new Request("https://unit.test/health"),{});
 assert.equal(r.status,200);
 assert.equal((await r.json()).ok,true);
});
