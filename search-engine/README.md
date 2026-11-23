# MarcoSearch — 真正的多來源電影搜索引擎

這個 Node.js 20+ 服務實際在搜索時向多個 CMS 來源發送請求，合併結果與播放來源，而不是只有固定片單或搜尋規則。

## 服務功能
- 支援任意電影、電視劇、動漫名稱的即時搜尋，並非限於既有 162 部 Cult 電影。
- 聚合多個 CMS 搜尋結果、合併同名作品、保留原始站點的播放詳情。
- 對已知作品使用中／英／日文別名；可選擇使用 TMDB API Token 拓展原始片名。
- 限制搜尋站點數、並行數、單站點逾時和快取，避免大量失效來源拖垮搜索。
- 對 Marco Movie 提供標準 CMS 接口，可以作為一個獨立的站點加入既有配置。

## 本機啟動

需要 Node.js 20 或更新版本。於 search-engine 資料夾執行：

    npm test
    npm start

訪問本機測試路徑：

    http://localhost:3000/health
    http://localhost:3000/api.php/provide/vod/?ac=videolist&wd=Tetsuo

## 部署（Render 或 Railway）

1. 將公開 GitHub 儲存庫 Sairai1/marcomovie-config 與託管服務連接。
2. 專案 Root Directory 填寫 search-engine。
3. Runtime 選 Node，版本 20+；無額外依賴。
4. Start Command：npm start。部署後使用 HTTPS 網域。
5. 可選環境變數：SEARCH_SOURCES=24、MAX_BUSY=8、TMDB_READ_ACCESS_TOKEN（只放在服務端）。
6. 測試 https://你的服務網域/health，以及 /api.php/provide/vod/?ac=videolist&wd=Tetsuo。
7. 確認成功後，才將此 CMS API URL 加入 all.json 的 sites：

    {
      "key":"marco_search",
      "name":"MarcoSearch 跨片源搜索",
      "type":1,
      "api":"https://你的服務網域/api.php/provide/vod/",
      "searchable":1,
      "quickSearch":1,
      "filterable":0
    }

**注意：目前 GitHub 只儲存程式碼，還沒有部署可供手機使用的公開搜尋網址。** GitHub Raw 不能執行程式，請勿將範例網址當成已部署服務。

## API
- GET /health：健康檢查
- GET /api.php/provide/vod/：首頁分類
- GET /api.php/provide/vod/?ac=videolist&wd=關鍵詞：跨站搜索
- GET /api.php/provide/vod/?ac=detail&ids=ms1_...：取得相應站點的詳細播放列表

## 使用限制
- 支援標準 JSON CMS；目前沒有 XML、特殊 Spider/JAR 或需登入的平台適配。
- 片名去重仍可能因年份、翻譯和版本誤差而不完美。
- 某些網站可能拒絕服務端請求或有跨區限制；因此不能保證每次全部來源都可用。
- 搜索資料並不保證有可播放影片、合法授權或完整版；本程式不託管或代理任何影片。
- 公開服務請另設速率限制、監控、權限審核；初版適合個人測試。
- 可在 GitHub 新增新的合法 CMS 來源，重啟或快取到期後會採用新的 all.json 配置。
