#!/usr/bin/env python3
"""Spot-check TVBox CMS title coverage for a multilingual cult-film catalogue.

Read-only catalogue metadata queries. Does not obtain or verify media files,
playback availability, rights or full-length editions.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


def norm(value):
    return re.sub(r"[\W_]+", "", str(value).casefold())


def query(site, keyword, timeout):
    parts = urlsplit(site["api"])
    if parts.scheme != "https" or not parts.hostname:
        return "invalid_url", []
    args = dict(parse_qsl(parts.query, keep_blank_values=True))
    args.update({"ac": "videolist", "wd": keyword, "pg": "1"})
    url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(args), ""))
    req = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json, application/xml, text/xml"})
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read(750_001)
        if len(raw) > 750_000:
            return "too_large", []
        raw = raw.decode("utf-8-sig", errors="replace").strip()
        if raw.startswith("<"):
            root = ET.fromstring(raw)
            found = [node.text.strip() for node in root.iter()
                     if node.tag.rsplit("}", 1)[-1].lower() in ("name", "vod_name", "title") and node.text]
            return "ok", found
        data = json.loads(raw)
        if isinstance(data, dict):
            items = data.get("list", data.get("data", data.get("vod_list", [])))
            if isinstance(items, dict):
                items = items.get("list", [])
        elif isinstance(data, list):
            items = data
        else:
            items = []
        return "ok", [str(x.get("vod_name") or x.get("title") or x.get("name"))
                      for x in items if isinstance(x, dict) and
                      (x.get("vod_name") or x.get("title") or x.get("name"))]
    except HTTPError as ex:
        return f"http_{ex.code}", []
    except (URLError, TimeoutError, ValueError, ET.ParseError, json.JSONDecodeError, OSError) as ex:
        return type(ex).__name__, []


def terms(film, cap):
    names = [film.get("title_cn"), film.get("title_en"), film.get("title_ja"), *(film.get("aliases") or [])]
    seen = set()
    values = []
    for name in names:
        if not name:
            continue
        n = norm(name)
        if len(n) >= 3 and n not in seen:
            seen.add(n)
            values.append(name)
    return values[:cap]


def check(sites, films, variants, timeout, delay):
    rows = []
    for site in sites:
        print(f"Checking source: {site.get('name')}", file=sys.stderr)
        for film in films:
            hits = []
            failures = []
            for term in terms(film, variants):
                status, titles = query(site, term, timeout)
                if status != "ok":
                    failures.append(status)
                if status == "ok":
                    for title in titles:
                        if norm(term) in norm(title) or norm(title) in norm(term):
                            if len(norm(title)) >= 3 and title not in hits:
                                hits.append(title)
                time.sleep(delay)
                if hits:
                    break
            result = "title_hit_unverified" if hits else (
                "no_title_match" if not failures or len(failures) < variants else "unverified_request")
            rows.append({"source": site.get("name", ""), "film_id": film.get("id", ""),
                         "category": film.get("category", ""), "title": film.get("title_en", ""),
                         "result": result, "returned_titles": " / ".join(hits[:3]),
                         "errors": ", ".join(sorted(set(failures)))})
    return rows


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", default="all.json")
    p.add_argument("--catalog", default="catalogs/cult-films.json")
    p.add_argument("--category", default="", help="substring filter for one cult category")
    p.add_argument("--sources", type=int, default=5)
    p.add_argument("--films", type=int, default=8)
    p.add_argument("--variants", type=int, default=2)
    p.add_argument("--timeout", type=float, default=5)
    p.add_argument("--delay", type=float, default=0.5)
    p.add_argument("--out", default="cult-coverage.csv")
    a = p.parse_args()
    if not (1 <= a.sources <= 60 and 1 <= a.films <= 200 and 1 <= a.variants <= 8
            and 1 <= a.timeout <= 20 and 0.2 <= a.delay <= 10):
        p.error("Outside safe limits")
    config = json.loads(Path(a.config).read_text("utf-8-sig"))
    catalog = json.loads(Path(a.catalog).read_text("utf-8-sig"))
    sites = [s for s in config["sites"] if s.get("type") == 1 and s.get("searchable", 1)
             and str(s.get("api", "")).startswith("https://")][:a.sources]
    films = [f for f in catalog["films"] if not a.category or a.category in f["category"]][:a.films]
    if not films:
        p.error("No films match the requested category")
    rows = check(sites, films, a.variants, a.timeout, a.delay)
    with open(a.out, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["source", "film_id", "category", "title",
                                               "result", "returned_titles", "errors"])
        writer.writeheader()
        writer.writerows(rows)
    hits = sum(x["result"] == "title_hit_unverified" for x in rows)
    print(f"Wrote {len(rows)} source-title checks to {a.out}; {hits} unverified title matches.")
    print("IMPORTANT: title match is not proof of playable or licensed video.")


if __name__ == "__main__":
    main()
