#!/usr/bin/env python3
"""Check title coverage for a rare-film series in TVBox-compatible CMS catalogues.

Read-only metadata queries. A matching title is NOT proof of playable video,
license, region access, or a complete work. Use respectfully with authorized APIs.
Requires only Python 3.10+ standard library.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def normalized(text):
    return re.sub(r"[\s·:：,，.。!！?？\-_—()（）\[\]【】《》]+", "", str(text).casefold())


def lookup_url(base, keyword):
    p = urlsplit(base)
    if p.scheme != "https" or not p.hostname:
        raise ValueError("only HTTPS sources are queried")
    query = dict(parse_qsl(p.query, keep_blank_values=True))
    query.update({"ac": "videolist", "wd": keyword, "pg": "1"})
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(query), ""))


def parse_titles(payload):
    text = payload.lstrip("\ufeff \t\r\n")
    if text.startswith("<"):
        root = ET.fromstring(text)
        tags = ("name", "vod_name", "title")
        out = []
        for node in root.iter():
            if node.tag.lower().split("}")[-1] in tags and node.text:
                out.append(node.text.strip())
        return out
    obj = json.loads(text)
    if isinstance(obj, dict):
        items = obj.get("list") or obj.get("data") or obj.get("vod_list") or []
        if isinstance(items, dict):
            items = items.get("list") or items.get("data") or []
    elif isinstance(obj, list):
        items = obj
    else:
        return []
    return [
        str(item.get("vod_name") or item.get("name") or item.get("title")).strip()
        for item in items if isinstance(item, dict)
        and (item.get("vod_name") or item.get("name") or item.get("title"))
    ]


def query(base, keyword, timeout):
    url = lookup_url(base, keyword)
    req = Request(url, headers={
        "User-Agent": "MarcoMovie-coverage-audit/1.0 (catalogue metadata only)",
        "Accept": "application/json, text/xml, application/xml, */*",
    })
    try:
        with urlopen(req, timeout=timeout) as response:
            data = response.read(1_000_001)
            if len(data) > 1_000_000:
                return {"status": "response_too_large", "titles": []}
        titles = parse_titles(data.decode("utf-8-sig", errors="replace"))
        return {"status": "ok", "titles": titles}
    except HTTPError as e:
        return {"status": "http_" + str(e.code), "titles": []}
    except (URLError, TimeoutError, ValueError, ET.ParseError, json.JSONDecodeError, OSError) as e:
        return {"status": "error_" + type(e).__name__, "titles": []}


def check(config, index, limit, timeout, pause, variants):
    films = index["films"]
    sites = [
        site for site in config.get("sites", [])
        if isinstance(site, dict) and site.get("type") == 1
        and site.get("searchable", 1) and str(site.get("api", "")).startswith("https://")
    ][:limit]
    report = []
    for site in sites:
        record = {"name": site.get("name", site.get("key", "?")),
                  "api": site["api"], "films": {}}
        for film in films:
            keywords = [
                film["title_cn"], film["title_en"],
                film["title_ja"], *film.get("aliases", [])
            ]
            seen = set()
            keywords = [k for k in keywords if not (normalized(k) in seen or seen.add(normalized(k)))]
            statuses = []
            matched = []
            for keyword in keywords[:variants]:
                answer = query(site["api"], keyword, timeout)
                statuses.append(answer["status"])
                for title in answer["titles"]:
                    if normalized(keyword) in normalized(title) or normalized(title) in normalized(keyword):
                        if len(normalized(title)) > 2 and title not in matched:
                            matched.append(title)
                time.sleep(pause)
                if matched:
                    break
            record["films"][film["id"]] = {
                "status": "title_hit_unverified" if matched else
                    ("catalogue_no_match" if "ok" in statuses else "request_unverified"),
                "titles": matched[:5],
                "queries": keywords[:len(statuses)],
                "request_status": statuses,
            }
        report.append(record)
        print(f"Checked: {record['name']}", file=sys.stderr)
    return report


def render(index, rows):
    ids = [film["id"] for film in index["films"]]
    lines = ["# 豚鼠系列：影视接口标题检索覆盖报告", "",
             "本报告仅测试来源是否返回相关标题；**不证明影片可播放，也不代表授权状态。**",
             "网络失败、反爬和接口不支持标准查询都可能导致误判。", "",
             "| 影视接口 | " + " | ".join(ids) + " |",
             "| --- | " + " | ".join(["---"] * len(ids)) + " |"]
    labels = {"title_hit_unverified": "标题命中",
              "catalogue_no_match": "未命中",
              "request_unverified": "请求未确认"}
    for row in rows:
        lines.append("| " + row["name"].replace("|", "／") + " | " +
                     " | ".join(labels[row["films"][id]["status"]] for id in ids) + " |")
    lines.extend(["", "## 各条目", ""])
    for film in index["films"]:
        lines.append("- " + film["id"] + " — " + film["title_cn"] + " / " + film["title_en"])
    lines.extend(["", "## 说明",
                  "只有通过用户合法访问且能打开影片详情并播放的来源，才能单独验证播放情况。"])
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="all.json")
    parser.add_argument("--index", default="catalogs/guinea-pig.json")
    parser.add_argument("--limit", type=int, default=8, help="max sources to check")
    parser.add_argument("--variants", type=int, default=3, help="max aliases per film per source")
    parser.add_argument("--timeout", type=float, default=5)
    parser.add_argument("--pause", type=float, default=0.5)
    parser.add_argument("--out", default="coverage-report.md")
    args = parser.parse_args()
    if not (1 <= args.limit <= 100 and 1 <= args.variants <= 15 and
            1 <= args.timeout <= 30 and 0.1 <= args.pause <= 10):
        parser.error("parameters exceed safe query limits")
    cfg, idx = load_json(args.config), load_json(args.index)
    result = check(cfg, idx, args.limit, args.timeout, args.pause, args.variants)
    Path(args.out).write_text(render(idx, result), encoding="utf-8")
    print(f"Report: {args.out}")


if __name__ == "__main__":
    main()
