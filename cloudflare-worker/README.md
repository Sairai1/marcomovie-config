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
