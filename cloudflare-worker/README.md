# MarcoSearch — Cloudflare Workers Free

本專案是真正的多來源 CMS 實時搜尋引擎，不是只有電影片名規則。可作為 Marco Movie iOS 中一個額外的 TVBox CMS 站點，與原有電影／動漫／直播配置共存。

## v1.1：新增的四个独立搜索入口

2026-11-23 已部署到 `https://marcomovie-config.guochuwei0913.workers.dev`，并通过 GitHub Actions 对公网真实接口测试。

| 名称 | TVBox CMS 接口 | 结果类型 |
| --- | --- | --- |
| MarcoSearch 1 | `/api.php/provide/vod/shard/1/` | 17 个原有 CMS 的**实时检索结果** |
| MarcoSearch 2 | `/api.php/provide/vod/shard/2/` | 17 个原有 CMS 的实时检索结果 |
| MarcoSearch 3 | `/api.php/provide/vod/shard/3/` | 17 个原有 CMS 的实时检索结果 |
| MarcoDiscover | `/api.php/discover/vod/` | Wikidata、Apple iTunes 和 TVmaze 的**资料检索**，TMDB 可选；**无内置播放** |
| 原版 MarcoSearch | `/api.php/provide/vod/` | 旧版来源分页检索，保留兼容 |

不同于原版按 `pg` 轮询 51 个来源，新增的三条 CMS 入口在 iOS 应用的全局搜索里可作为**三个独立站点**被调用，实现一次全局搜索覆盖 51 个候选 CMS 来源；如果客户端只搜索当前选中的站点，仍需勾选全部三项。

MarcoDiscover 独立查询外部影视资料库，不复用 51 个 CMS 的缓存结果，也不将静态 `cult-films.json` 中的片名伪装成外部检索命中。只有在线服务返回的条目才会显示。公开资料不证明作品具备正版播放权、完整版本或现成视频链接。Apple API 可能因为访问频率返回 429，其他引擎仍能独立运行。

**验证：**

- `/health` 应显示版本 `1.1.0`。
- `/api.php/provide/vod/shard/1/?ac=detail&wd=铁男`。
- `/api.php/provide/vod/shard/2/?ac=detail&wd=铁男`。
- `/api.php/provide/vod/shard/3/?ac=detail&wd=铁男`。
- `/api.php/discover/vod/?ac=detail&wd=Guinea%20Pig`。

所有这些入口都遵循 TVBox 风格的 `ac=detail&wd=` 或 `ac=videolist&wd=` 查询格式。资料库结果的 `vod_play_url` 保持空值，明确与影视播放源分开。


## 免費額度限制與技術設計

- 官方 Free 額度（2026-11）：100,000 次 Worker 請求／日，50 次外部子請求／次，6 個同時對外連線。參考 https://developers.cloudflare.com/workers/platform/limits/
- 搜尋預設每頁 16 個 CMS，最大 20 個；每站最多 2 次搜尋，最多 4 個並行連線。另有 2 次配置／片單查詢，TMDB 可選 1 次；即使最大全部成功，也控制在免費配額內。
- 51 個候選 CMS 分成多頁搜尋（預設 4 頁），使用 pg=1、2、3、4 改變掃描的站點批次；單次搜尋不保證所有站點都返回結果。
- 支援標準 JSON CMS 搜尋及基本 XML 影片列表；影片詳情與播放線路主要依賴 JSON CMS。沒有影片託管、媒體下載或轉碼，也不繞過 DRM。
- 自動按片名／可得的多語言別名合併結果，僅對已匹配的已知作品展開別名，不限制其他任意輸入的片名。
- 選配 TMDB_READ_ACCESS_TOKEN，可延伸電影原名查找；未設定也能搜尋。不可把 Token 放入公開 JSON。

## 一鍵從 GitHub 部署（不需要自備伺服器）

1. 進入 https://dash.cloudflare.com/ ，選擇 Workers & Pages / Create application。
2. 連接 GitHub；選擇公共儲存庫 Sairai1/marcomovie-config。如果無法看到儲存庫，請在 GitHub App 授權頁把該倉庫加入可訪問清單。
3. 服務類型選 Worker，使用 GitHub 建立 Worker（Workers Builds/Import a repository）。
4. **Project Name：marco-search-sairai**（必須與 wrangler.jsonc 的 name 相符）。
5. **Root Directory：cloudflare-worker**。Workers Builds 需要在此目錄找到 wrangler.jsonc。
6. Build Command：npm test；Deploy Command：npx wrangler deploy。依平台畫面指示先安裝 npm dependencies（package.json 已列出 wrangler）。
7. 選 Workers Free，完成 Create / Save and Deploy；根據 Cloudflare 帳戶狀態可能需要完成額外的驗證，請核對費用頁，不要選 Paid。
8. 成功後複製 Cloudflare 真正提供的 **https://...workers.dev** URL，勿猜測子網域名稱。

官方 GitHub 部署說明：https://developers.cloudflare.com/workers/ci-cd/builds/
官方部署配置說明：https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

## 驗證

在實際得到的 Workers HTTPS 網域後，訪問：

    https://實際網域/health
    https://實際網域/api.php/provide/vod/?ac=detail&wd=Tetsuo
    https://實際網域/api.php/provide/vod/?ac=videolist&wd=Eraserhead&pg=2

第一條應返回 ok:true；後兩條是動態搜尋；即使 list 為空，也能看 search_info.scanned 是否有搜索到來源。

## 接入 Marco Movie

確認部署真實可用後，在主倉庫 all.json 的 sites 新增一項，api 一定要換成 Cloudflare 分配的實際 HTTPS 網域：

    {
      "key": "marco_search",
      "name": "🔎 MarcoSearch Workers · 跨站聚合",
      "type": 1,
      "api": "https://實際網域/api.php/provide/vod/",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 0
    }

**在 Worker 未部署之前不要修改 all.json。** 這個 Cloudflare Worker 排除 `marco_search` 自身，避免無限遞歸搜索。

## 運行測試

本目錄 package.json 使用 ESM 和 Node.js 22，執行 `npm test`，無需依賴 Cloudflare 連線即可驗證搜索聚合、XML/JSON CMS 解析、片名去重、詳情合併及 HTTP 路由。

## 限制與注意

1. 外部 CMS 候選列表不代表每站穩定、具合法授權或真的有你要的影片；聚合只能提升搜索範圍，不能保證找到完整 Cult 系列或無刪減版本。
2. Workers Free 的 CPU 配額也很低；太大規模的搜索可能超出配額，預設以保守的每頁 16 站部署。
3. 某些 CMS 站會拒絕 Cloudflare 伺服端請求，空搜索结果不等同於該作品絕不存在。
4. 公開的 .workers.dev 入口沒有登入驗證，可能被其他人使用並耗掉免費額度；正式公開使用前應增加 Cloudflare 管控。
5. 因為不是串流代理，實際影片載入能力、版權授權、地理限制和字幕仍依各站提供。

## v1.2 — 外部影片來源擴充（2026-11-23）

**MarcoArchive — 已接入 all.json、已通過公網測試。** 使用 Internet Archive 官方 Advanced Search API，僅查 mediatype:movies 的真實影片目錄，與原 51 個 CMS 不同。

- 搜索入口：/api.php/archive/vod/?ac=detail&wd=Night%20of%20the%20Living%20Dead
- 返回標題、年份、archive.org/details 原站頁面；不偽造串流、下載或授權。Archive 可能包含片段、預告片、使用者上傳資料，結果不等於完整正版。
- 公網測試：.github/workflows/verify-external-engines.yml。

**PanSou — 適配器已完成，但沒有部署自建後端，未加入正式訂閱。** fish2018/pansou 是 Go 服務，不能把其原始服務直接當作 Cloudflare Worker 使用。

- 需另行有合法可用的 HTTPS PanSou 服務；在 Worker Variables 設 PANSOU_API_URL，例如 https://your-pansou.example。
- 若 PanSou 啟用認證，在 Worker Secrets 設 PANSOU_BEARER_TOKEN；勿把憑證放進 GitHub、all.json 或聊天。
- 搜索入口：/api.php/pansou/vod/?ac=detail&wd=片名；向固定服務 GET /api/search?kw=...，解析 merged_by_type，顯示受限制的 HTTPS 網盤分享頁面。不下載、不繞過驗證、不冒充影片播放鏈接。
- 官方專案：https://github.com/fish2018/pansou

**Watchmode — 適配器已完成，但需要 API Key，未加入正式訂閱。** 它提供合法平台的可用位置而非影音檔案。

- 前往 https://api.watchmode.com/requestApiKey/ 申請。Developer Free 目前 2,500 credits/月；只允許非商業用途，顯示結果須署名及連結 Watchmode.com，詳見 https://api.watchmode.com/pricing。
- 在 Worker Secrets 設 WATCHMODE_API_KEY；可選 Worker Variable WATCHMODE_REGIONS=US,TW（需符合帳戶開通區域）。金鑰只以 X-API-Key header 傳給 Watchmode。
- 搜索入口：/api.php/watchmode/vod/?ac=detail&wd=The%20Matrix；詳情調用 Title Sources 位置接口；不提供內建播放。

### 啟用方式與界限

於 Cloudflare Worker → Settings → Variables and Secrets 設定對應 Secret/Variable；確認來源實際返回可用的、適當授權的結果後，才加入 all.json。不要把任何 Secret 寫到公開配置。

Worker /health 版本：1.2.0。正式訂閱目前 57 個影視與搜尋入口，保留原 85 組直播。57 個入口並不代表 57 個全新片庫，之前的 51 個 CMS 仍是原有來源。

## v1.3 — 點開影片與首次播放加速

**2026-11-23** 針對 iOS Marco Movie 使用者點擊 MarcoSearch 影片後等待詳情及首條播放線路的問題：

- 舊版 detail() 對最多五個 CMS 來源做 Promise.all，需等最慢一站（每站最大 3,400ms）才能返回，造成首次進入播放器等待。
- 新版優先返回第一條有實際集數／播放網址的線路；稍等預設 260ms 收集其他快速備援，之後取消尚未完成的慢來源請求。若沒有任一可播放線路，仍等待全部來源到逾時，以降低誤判空片源。
- 冷啟動 CMS 詳情會先使用 Worker 內建的來源快照，不必先向 GitHub Raw 讀取 all.json 與 Cult 片單。未知來源仍自動使用動態配置回退。一般影視搜尋仍讀最新配置。
- 詳情快取在 MarcoSearch 原版與 1／2／3 分組之間共用；同一個 composite vod_id 可復用已取回的結果。
- 選擇性除錯模式：在 detail URL 加上 `full=1`，會等待所有來源並整合完整備援線路（比快速模式更慢）。預設 Marco Movie 不必修改。
- Cloudflare Worker vars: DETAIL_BACKUP_GRACE_MS=260（0–800ms），DETAIL_TIMEOUT_MS=3400（500–4500ms）。短 grace 令首播更快，但備援線路可能較少；完整模式用於排除特定片源問題。
- 假冒或空白播放網址不應觸發提前返回。已添加自動測試涵蓋早返回、有備援、無播放、全來源模式及冷詳情不讀 GitHub。
- **限制：** 本加速只縮短詳情 API 的等待時間，並不代理或加速第三方 M3U8/MP4 影音內容；若開始播放後仍緩衝，應切換不同播放線路或合法串流平台。

健康檢查 `/health` 的新版本：1.3.0。直播配置及原訂閱 URL 保持不變。
