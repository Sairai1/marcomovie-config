# Cult／邪典電影搜尋擴充（2026-11-23）

## 這個項目提供什麼？
- [all.json](../all.json)：Marco Movie iOS 的 TVBox 點播 + 全球直播訂閱配置，現為 **51 個標準 CMS 候選站點及 85 組直播訂閱**，並非 51 個已核實的可播放站點。
- [catalogs/cult-films.json](../catalogs/cult-films.json)：**162 部 Cult／邪典電影，8 類**，包括中、英文及可得的日文／原文、通用別名。
- [tools/check_cult_coverage.py](../tools/check_cult_coverage.py)：搜尋 CMS 目錄標題並產生 CSV 命中表；**不提供影片播放，也不會自動修改 Marco Movie 的搜尋邏輯**。
- [cult-pre-v2-backup.json](../cult-pre-v2-backup.json)：增加 Cult 候選源前的配置備份。

## 主要題材
1. 日本地下／獵奇／恐怖
2. 意大利鉛黃／哥德恐怖
3. 香港邪典／奇情／靈幻
4. 血漿／剝削／地下 B 級片
5. 超現實／藝術邪典
6. B 級科幻／怪獸／怪奇喜劇
7. 歐陸極端／驚悚邪典
8. 亞洲其他／當代 Cult

Cult 標籤具有主觀性；此片單是檢索樣本，不是權威評定，也不是可看保證。

## 怎樣提升實際搜尋命中？
TVBox JSON 中的 `sites` 是一組外部搜尋入口，**不是中央統一片名索引**。Marco Movie 搜尋僅收到各站原樣返回的結果。
- 搜尋中文譯名及英文原名；日本片試日文原名。
- 有同名或翻拍電影時，加年份搜尋；先用各片名做關鍵字，不只搜系列總稱。
- 對未命中的電影，先用脚本確認哪個 CMS 有「標題命中」；再在 App 裡檢查是否真有影片及合法觀看資格。
- 假如接口完全沒收錄，換別名無法產生新片源。

## 本機測試（需要 Python 3.10+）
下載整個倉庫後：
```bash
python3 tools/check_cult_coverage.py --category "日本地下" --sources 5 --films 12 --out report-jp.csv
python3 tools/check_cult_coverage.py --category "意大利" --sources 5 --films 12 --out report-giallo.csv
```

缺省會抽查 5 來源 × 8 部作品，每部最多 2 個檢索詞，順序發送低頻讀取型請求；大規模檢查需自行確保符合第三方服務條款。CSV 的 `title_hit_unverified` 僅代表某個來源返回了匹配標題，不代表可播放、完整版、中文字幕、無刪減或已取得授權。`unverified_request` 也可能是封鎖或網路問題，不代表電影一定沒有。

## 合法專業片庫／策展參考
- [ARROW](https://www.arrowvideochannel.com/)
- [MUBI Cult](https://mubi.com/en/browse/genre/cult)
- [BFI Player](https://player.bfi.org.uk/)
這些商業服務 **不是 TVBox CMS 訂閱源**，不能直接當作 `sites[].api` 匯入；目錄與播放權限因地區而異。
