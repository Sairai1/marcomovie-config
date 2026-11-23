/*
 * Independent catalogue adapters for Marco Movie.
 *
 * Internet Archive: public video-item directory, links to original Archive page
 * PanSou: OPTIONAL self-hosted Go service (GET /api/search?kw=)
 * Watchmode: OPTIONAL licensed streaming availability API (requires free API key)
 *
 * No media proxy, no synthesized playback URLs, no scraping of paywalls.
 */
import {normalize,expandTerms} from "./engine.js";

const h=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=s=>String(s??"").trim();
function escapeSearch(s){
  return val(s).replace(/["\\:(){}\[\]^~*?!+\-/]/g," ").replace(/\s+/g," ").trim().slice(0,80);
}
function strYear(s){
  return (val(s).match(/\b(?:18|19|20)\d{2}\b/)||[])[0]||"";
}
function relevant(title,terms){
  const t=normalize(title);
  return terms.some(x=>{const n=normalize(x);return n.length>=3&&(t.includes(n)||(n.length>6&&n.includes(t)&&t.length>=5));});
}
function titleAliasTerms(term,aliases=new Map()){
  return expandTerms(term,aliases).slice(0,3);
}
function cleanUrl(link,allowed=null){
  try{
    const u=new URL(link);
    if(u.protocol!=="https:"||u.username||u.password||u.port)return "";
    if(!u.hostname.includes(".")||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname))return "";
    if(allowed&&!allowed.some(host=>u.hostname===host||u.hostname.endsWith("."+host)))return "";
    return u.href.slice(0,1200);
  }catch{return "";}
}
async function fetchJSON(url,opts={}){
  const fetcher=opts.fetcher||fetch,controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),opts.timeout||4000);
  try{
    const res=await fetcher(url,{signal:controller.signal,redirect:"manual",method:opts.method||"GET",
      headers:{"Accept":"application/json",...(opts.headers||{})},body:opts.body});
    if(!res.ok)throw Error("HTTP_"+res.status);
    if(Number(res.headers?.get("content-length")||0)>900000)throw Error("oversize");
    const raw=await res.text();
    if(raw.length>900000)throw Error("oversize");
    return JSON.parse(raw);
  }finally{clearTimeout(timer);}
}
function refId(prefix,id){
  return prefix+"_"+encodeURIComponent(val(id));
}
function makeVod(id,name,remark,sourceUrl,description="",year=""){
  const url=cleanUrl(sourceUrl)||"";
  return {vod_id:id,vod_name:val(name).slice(0,170),vod_pic:"",
    vod_year:strYear(year),vod_remarks:remark,
    vod_content:"<p>"+h(description)+"</p>"+(url?"<p>官方／原站連結：<a href=\""+h(url)+"\">"+h(url)+"</a></p>":""),
    vod_play_from:"",vod_play_url:"",vod_blurb:val(description).slice(0,350)};
}
function listing(list,info){
  return {code:1,msg:"ok",list,page:1,pagecount:1,
    limit:list.length,total:list.length,search_info:info};
}
export function externalHome(kind){
  const labels={
    archive:"Internet Archive 開放影片目錄搜尋（原站核實版權和觀看方式）",
    pansou:"PanSou 網盤分享索引（需要自建服務；非在線播放源）",
    watchmode:"Watchmode 正版串流平台查詢（需 API Key；非在線播放源）"};
  return {code:1,msg:labels[kind]||"External lookup",
    class:[{type_id:"1",type_name:"影片搜尋"}],
    list:[],page:1,pagecount:1,limit:0,total:0};
}

// No-key archive search: an actual new film/video catalogue (not 51 CMS again).
export async function archiveSearch(term,aliases=new Map(),opts={}){
  const terms=titleAliasTerms(term,aliases);
  const queries=[terms[0]];
  const en=terms.find(t=>/[a-zA-Z]{3}/.test(t));
  if(en&&normalize(en)!==normalize(terms[0]))queries.push(en);
  const seen=new Set(),hits=[],statuses=[];
  for(const q of queries.slice(0,2)){
    const text=escapeSearch(q);
    if(!text)continue;
    const url=new URL("https://archive.org/advancedsearch.php");
    url.searchParams.set("q",'mediatype:movies AND title:("'+text+'")');
    url.searchParams.set("fl[]","identifier");
    url.searchParams.append("fl[]","title");
    url.searchParams.append("fl[]","date");
    url.searchParams.append("fl[]","year");
    url.searchParams.append("fl[]","rights");
    url.searchParams.set("rows","25");
    url.searchParams.set("output","json");
    try{
      const json=await fetchJSON(url.toString(),opts);
      const docs=json?.response?.docs||[];
      statuses.push({provider:"Internet Archive",query:q,status:"ok",count:docs.length});
      for(const doc of docs){
        const id=val(doc.identifier),title=val(Array.isArray(doc.title)?doc.title[0]:doc.title);
        if(!/^[a-zA-Z0-9_.-]{3,140}$/.test(id)||!title||seen.has(id)||!relevant(title,terms))continue;
        seen.add(id);
        const link="https://archive.org/details/"+encodeURIComponent(id);
        const desc="Internet Archive 影片目錄紀錄；是否可線上觀看、版權授權與影片完整性，請到原站確認。";
        const item=makeVod(refId("ia2",id),title,"Internet Archive · 原站影片頁面（非直接播放）",
          link,desc,doc.year||doc.date);
        if(item.vod_name)hits.push(item);
        if(hits.length>=45)break;
      }
    }catch(e){statuses.push({provider:"Internet Archive",query:q,status:val(e.message).slice(0,50),count:0});}
  }
  return listing(hits,{kind:"archive_item",engines:1,source_diagnostics:statuses});
}
export async function archiveDetail(encoded,opts={}){
  if(!/^ia2_[a-zA-Z0-9_.%-]{3,180}$/.test(val(encoded)))return [];
  let id;try{id=decodeURIComponent(encoded.slice(4));}catch{return [];}
  if(!/^[a-zA-Z0-9_.-]{3,140}$/.test(id))return [];
  const url="https://archive.org/details/"+encodeURIComponent(id);
  try{
    const d=await fetchJSON("https://archive.org/metadata/"+encodeURIComponent(id),opts);
    const meta=d.metadata||{};
    const title=val(Array.isArray(meta.title)?meta.title[0]:meta.title);
    if(!title||meta.mediatype!=="movies")return [];
    const desc=val(Array.isArray(meta.description)?meta.description[0]:meta.description).replace(/<[^>]*>/g," ").slice(0,300);
    const rights=val(meta.licenseurl||meta.rights||"授權未標示");
    const item=makeVod(encoded,title,"Internet Archive · 原站查閱（非直接播放）",
      url,desc+" 授權資訊："+rights,meta.year||meta.date);
    return [item];
  }catch{return [];}
}

const providerHosts=["pan.baidu.com","pan.quark.cn","www.alipan.com","www.aliyundrive.com",
  "www.123pan.com","www.115.com","115.com","pan.xunlei.com","pan.uc.cn",
  "cloud.189.cn","caiyun.139.com","drive.google.com","mega.nz","www.dropbox.com"];
function approvedPanSouBase(raw){
  if(!raw)return "";
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.port)return "";
    if(!u.hostname.includes(".")||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname))return "";
    if(["localhost","127.0.0.1"].includes(u.hostname))return "";
    // Only configured URLs, never query-provided proxy targets.
    return u.origin;
  }catch{return "";}
}
export async function panSouSearch(term,base,token="",opts={}){
  const origin=approvedPanSouBase(base);
  if(!origin)return {configured:false,...listing([],{kind:"cloud_shares",status:"not_configured",source_diagnostics:[]})};
  const url=origin+"/api/search?"+new URLSearchParams({kw:val(term).slice(0,90),res:"merge",src:"all"});
  try{
    const json=await fetchJSON(url,{...opts,timeout:5500,
      headers:token?{Authorization:"Bearer "+token}:{}});
    const grouped=json?.merged_by_type||{};
    const rows=[];
    for(const [platform,arr] of Object.entries(grouped)){
      if(!Array.isArray(arr))continue;
      for(const entry of arr){
        const link=cleanUrl(entry.url,providerHosts);
        const title=val(entry.note||entry.work_title||entry.title);
        if(!link||!title||!relevant(title,[term]))continue;
        rows.push({platform,title,link});
        if(rows.length>=60)break;
      }
    }
    const uniq=new Set(),list=[];
    for(const row of rows){
      if(uniq.has(row.link))continue;
      uniq.add(row.link);
      const encoded=btoa(Array.from(new TextEncoder().encode(JSON.stringify({
        link:row.link,title:row.title,platform:row.platform})),x=>String.fromCharCode(x)).join(""))
        .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
      list.push(makeVod("ps2_"+encoded,row.title,
        "PanSou · "+row.platform+" 網盤分享索引（非串流）",
        row.link,"第三方分享索引；可能失效、需要登入或未經授權，請自行確認合法性。"));
    }
    return {configured:true,...listing(list,{kind:"cloud_shares",status:"ok",
      found:list.length,source_diagnostics:[{provider:"PanSou",status:"ok",count:list.length}]})};
  }catch(e){
    return {configured:true,...listing([],{kind:"cloud_shares",
      source_diagnostics:[{provider:"PanSou",status:val(e.message).slice(0,60),count:0}]})};
  }
}
// No server-side storage: validated share URL is embedded in the detail ID
// and is never fetched by the Worker.
export function panSouDetail(encoded){
  if(typeof encoded!=="string"||!/^ps2_[a-zA-Z0-9_-]{12,2600}$/.test(encoded))return [];
  try{
    const bin=atob(encoded.slice(4).replace(/-/g,"+").replace(/_/g,"/"));
    const raw=new TextDecoder().decode(Uint8Array.from(bin,x=>x.charCodeAt(0)));
    const item=JSON.parse(raw);
    const link=cleanUrl(item.link,providerHosts);
    const title=val(item.title).slice(0,170),platform=val(item.platform).slice(0,40);
    if(!link||!title)return [];
    return [makeVod(encoded,title,"PanSou · "+platform+" 分享索引（非串流）",link,
      "僅列出第三方分享頁面，不是影片串流。確認分享者有適當授權後再使用。")];
  }catch{return [];}
}

const wmRegions=/^[A-Z]{2}(,[A-Z]{2}){0,2}$/;
function watchmodeRegion(envRegions){
  const candidate=val(envRegions||"US,TW").toUpperCase();
  return wmRegions.test(candidate)?candidate:"US";
}
export async function watchmodeSearch(term,key,opts={}){
  if(!key)return {configured:false,...listing([],{kind:"availability",status:"not_configured"})};
  const url=new URL("https://api.watchmode.com/v1/search/");
  url.searchParams.set("apiKey",key);
  url.searchParams.set("search_field","name");
  url.searchParams.set("search_value",val(term).slice(0,90));
  url.searchParams.set("types","movie,tv");
  try{
    const d=await fetchJSON(url.toString(),opts);
    const arr=Array.isArray(d.title_results)?d.title_results:[];
    const list=arr.filter(x=>x.id&&x.name&&relevant(x.name,[term]))
      .slice(0,25).map(x=>makeVod(refId("wm2",x.id),x.name,
        "Watchmode · 正版平台查詢（點開可查看服務）",
        "https://www.watchmode.com/","Watchmode 片目資料，免費版需署名 Watchmode.com。",x.year));
    return {configured:true,...listing(list,{kind:"availability",
      source_diagnostics:[{provider:"Watchmode",status:"ok",count:list.length}]})};
  }catch(e){
    return {configured:true,...listing([],{kind:"availability",
      source_diagnostics:[{provider:"Watchmode",status:val(e.message).slice(0,50),count:0}]})};
  }
}
export async function watchmodeDetail(encoded,key,region="US",opts={}){
  if(!key||!/^wm2_\d{1,12}$/.test(val(encoded)))return [];
  const id=encoded.slice(4),regions=watchmodeRegion(region);
  const url=new URL("https://api.watchmode.com/v1/title/"+id+"/sources/");
  url.searchParams.set("apiKey",key);url.searchParams.set("regions",regions);
  try{
    const d=await fetchJSON(url.toString(),opts);
    const providers=(Array.isArray(d)?d:[])
      .filter(x=>regions.split(",").includes(val(x.region||"US").toUpperCase()))
      .slice(0,25).map(x=>({provider:val(x.name).slice(0,100),
        type:val(x.type).slice(0,50),url:cleanUrl(x.web_url)}));
    const text=providers.length?"已檢出的正版觀看平台："+providers.map(x=>x.provider+"（"+x.type+"）").join("、"):
      "目前所選地區未回傳平台來源。";
    const vod=makeVod(encoded,"Watchmode 片目 #"+id,
      "Watchmode · 正版平台觀看位置（非直接播放）",
      "https://www.watchmode.com/",text+" 資料：Watchmode.com");
    vod.vod_content+="<p>"+providers.filter(x=>x.url).map(x=>
      '<a href="'+h(x.url)+'">'+h(x.provider)+"</a>").join(" · ")+"</p>";
    return [vod];
  }catch{return [];}
}
