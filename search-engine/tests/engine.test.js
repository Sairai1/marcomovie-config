import test from "node:test";
import assert from "node:assert/strict";
import {normalize,safeSource,expandQuery,cmsItems,mergeResults,decodeId,searchAcross,resolveDetails,homeData} from "../engine.js";

const film={id:"film1",title_cn:"鐵男",title_en:"Tetsuo: The Iron Man",title_ja:"鉄男",aliases:["Tetsuo"]};
const site=(key,api)=>({key,name:"测试-"+key,type:1,api,searchable:1,quickSearch:1});
const sources=[site("a","https://example.org/api.php/provide/vod/"),site("b","https://example.net/api.php/provide/vod/")];

test("normalization",()=>{
 assert.equal(normalize("Tetsuo: The Iron Man"),"tetsuotheironman");
 assert.equal(normalize("鉄 男"),"鉄男");
});
test("safe sources require external https",()=>{
 assert.equal(safeSource(sources[0]),true);
 assert.equal(safeSource(site("x","http://example.org/vod")),false);
 assert.equal(safeSource(site("x","https://127.0.0.1/vod")),false);
});
test("known title expansion and arbitrary query",()=>{
 assert.deepEqual(expandQuery("鐵男",[film]).slice(0,2),["鐵男","Tetsuo: The Iron Man"]);
 assert.deepEqual(expandQuery("未知新電影",[film]),["未知新電影"]);
});
test("common CMS JSON parsing",()=>{
 assert.equal(cmsItems(JSON.stringify({list:[{vod_id:12,vod_name:"鐵男"}]})).length,1);
 assert.equal(cmsItems("garbage").length,0);
});
test("duplicate titles merge across sources",()=>{
 const l=mergeResults([
 {site:sources[0],item:{vod_id:"abc",vod_name:"鐵男",vod_year:"1989"}},
 {site:sources[1],item:{vod_id:"def",vod_name:"Tetsuo: The Iron Man",vod_year:"1989"}}
 ],"鐵男",[film]);
 assert.equal(l.length,1);
 assert.equal(decodeId(l[0].vod_id).length,2);
});
test("live search calls real CMS shape and aggregates results",async()=>{
 const calls=[];
 const fetcher=async url=>{
  calls.push(url);
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({
   list:[{vod_id:url.includes("example.net")?"b123":"a123",vod_name:"鐵男",vod_year:"1989"}]
  })};
 };
 const out=await searchAcross("鐵男",{sites:sources,films:[film]},{
  fetcher,limit:2,concurrency:2,maxTimeMs:5000
 });
 assert.equal(out.list.length,1);
 assert.equal(out.searched,2);
 assert.equal(decodeId(out.list[0].vod_id).length,2);
 assert(calls.every(url=>url.includes("wd=")&&url.includes("ac=videolist")));
});
test("detail retrieval uses original CMS data",async()=>{
 const key=mergeResults([{site:sources[0],item:{vod_id:"a123",vod_name:"鐵男"}}],
 "鐵男",[film])[0].vod_id;
 const fetcher=async()=>({ok:true,headers:{get:()=>null},
 text:async()=>JSON.stringify({list:[{vod_id:"a123",vod_name:"鐵男",
 vod_play_from:"本人自有媒體",vod_play_url:"正片$https://example.org/video.mp4"}]})});
 const out=await resolveDetails(key,{sites:sources,films:[film]},{fetcher});
 assert.equal(out.length,1);
 assert.match(out[0].vod_play_url,/example.org\/video.mp4/);
});
test("home categories",()=>assert(homeData().class.length>=1));
