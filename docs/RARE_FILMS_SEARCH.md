# 冷门电影检索说明：日本《豚鼠》系列

**结论：全系列一般按六部日本原创电影统计。** 不同平台会把制作花絮、1991 精选合集和美版 `American Guinea Pig` 计为额外条目，第四至第六部的编号或年份也常有分歧。

请查看 [六部电影及别名 JSON](../catalogs/guinea-pig.json) 。

## 为什么当前 49 个电影接口仍可能搜不齐？

Marco Movie 的 TVBox 单仓配置是*来源列表*，不是电影数据库。播放器只检索接口公开的片名；如果影片不在第三方站点库内，不能通过修改 `all.json` 强制补齐。**不要把仅有电影元数据的条目伪装为可播放线路。**

## 在 App 内逐项搜这些词

1. 恶魔实验、恶魔试验、Devil's Experiment
2. 血肉之花、Flower of Flesh and Blood
3. 他不会死、不死人、He Never Dies
4. 下水道的美人鱼、地窖人鱼、Mermaid in a Manhole
5. 圣母机器人、Android of Notre Dame
6. 恶魔女医生、恶魔女医、Devil Woman Doctor

首先试「豚鼠」「ギニーピッグ」「Guinea Pig」，再搜独立片名。第 4-6 部的编号并不可靠，尤其不要仅以“豚鼠6”搜索判断收录情况。

## 技术验证

`tools/check_movie_coverage.py` 用 CMS 的 `ac=videolist&wd=...` 查询多个别名，输出每个来源六部影片的**标题命中矩阵**。注意：命中片名不等于可播放；HTTP 失败也不等于视频绝对不存在。仅针对自己有权使用的接口进行测试，避免频繁请求。

示例：
```bash
python3 tools/check_movie_coverage.py --config all.json --limit 8 --out coverage-report.md
```

如要扩大测试，使用 `--limit 49`。脚本默认低并发、短超时，仅请求元数据，不抓视频文件。

## 参考电影资料
- https://en.wikipedia.org/wiki/Guinea_Pig_(film_series)
- https://zh.wikipedia.org/wiki/豚鼠系列

**版权与播放：** 这份索引只描述作品，不提供盗版影片、未授权播放 URL 或绕过地区限制的方法。若要稳定拥有完整片库，可使用授权实体发行版或本人合法持有的影音文件。
