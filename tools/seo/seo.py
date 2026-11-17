"""Read-only Google Search Console fetcher for the GPA Calculator site.

Never prints or stores credentials. Uses only the webmasters.readonly scope.

    export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/noteflux-seo/credentials.json"
    uv run --project tools/seo python tools/seo/seo.py sites
    uv run --project tools/seo python tools/seo/seo.py fetch
"""
import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
from urllib.parse import quote

SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
BASE = "https://www.googleapis.com/webmasters/v3"
EXPECTED_SITE = "sc-domain:gpacalculatorfree.com"
PAGE = 25000
# Search types are fetched separately; they are not additive with each other.
SEARCH_TYPES = ["web", "image", "video", "news", "discover", "googleNews"]
# Search Console keeps ~16 months of data.
MAX_HISTORY_DAYS = 500
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "reports"

_session = None


def session():
    global _session
    if _session is None:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(scopes=[SCOPE])
        _session = AuthorizedSession(credentials)
    return _session


def call(url, body=None):
    response = session().request("GET" if body is None else "POST", url, json=body, timeout=120)
    if not response.ok:
        # Status only: never echo headers, tokens or raw auth responses.
        raise RuntimeError(f"Google API HTTP {response.status_code} for {url.split('?')[0]}")
    return response.json()


def list_sites():
    return call(f"{BASE}/sites").get("siteEntry", [])


def resolve_site():
    """Require an exact property that the key can really see. No fallbacks."""
    site = os.environ.get("GSC_SITE_URL", EXPECTED_SITE)
    if site != EXPECTED_SITE:
        raise SystemExit(f"Refusing {site!r}: this tool is pinned to {EXPECTED_SITE}")
    visible = {s["siteUrl"] for s in list_sites()}
    if site not in visible:
        raise SystemExit(f"{site} not visible to this key. Grant the service account access in Search Console.")
    return site


def query(site, start, end, dimensions=(), search_type="web", data_state="final"):
    """Fetch every row for one query shape, paginating until exhausted."""
    rows, offset = [], 0
    while True:
        body = {"startDate": str(start), "endDate": str(end), "type": search_type,
                "dataState": data_state, "rowLimit": PAGE, "startRow": offset}
        if dimensions:
            body["dimensions"] = list(dimensions)
        batch = call(f"{BASE}/sites/{quote(site, safe='')}/searchAnalytics/query", body).get("rows", [])
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE


def totals(site, start, end, search_type="web"):
    """Property-level aggregate (no dimensions). Never derived from breakdown rows."""
    rows = query(site, start, end, (), search_type)
    if not rows:
        return {"clicks": 0, "impressions": 0, "ctr": 0.0, "position": None}
    r = rows[0]
    return {k: r.get(k) for k in ("clicks", "impressions", "ctr", "position")}


def delta(cur, prev):
    out = {}
    for k in ("clicks", "impressions", "ctr", "position"):
        a, b = cur.get(k), prev.get(k)
        out[k] = {"current": a, "previous": b,
                  "abs": None if a is None or b is None else a - b,
                  "pct": None if not b or a is None else (a - b) / b}
    return out


def keyed_delta(cur_rows, prev_rows, limit=500):
    """Row-level comparison for a single dimension. Rows missing in one window are kept."""
    prev = {r["keys"][0]: r for r in prev_rows}
    cur = {r["keys"][0]: r for r in cur_rows}
    items = []
    for key in cur.keys() | prev.keys():
        c, p = cur.get(key), prev.get(key)
        items.append({"key": key,
                      "current": c and {k: c.get(k) for k in ("clicks", "impressions", "ctr", "position")},
                      "previous": p and {k: p.get(k) for k in ("clicks", "impressions", "ctr", "position")},
                      "clicks_change": (c["clicks"] if c else 0) - (p["clicks"] if p else 0),
                      "impressions_change": (c["impressions"] if c else 0) - (p["impressions"] if p else 0)})
    items.sort(key=lambda i: abs(i["impressions_change"]), reverse=True)
    return items[:limit]


def save(name, data):
    OUT.mkdir(exist_ok=True)
    path = OUT / name
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(path)
    return path


def fetch_all():
    site = resolve_site()
    today = datetime.now(timezone.utc).date()
    end = today - timedelta(days=2)  # latest days are provisional / not yet exposed
    start = end - timedelta(days=MAX_HISTORY_DAYS)
    manifest = {"site": site, "fetched_at": datetime.now(timezone.utc).isoformat(),
                "requested_start": str(start), "requested_end": str(end),
                "data_state": "final", "datasets": {}, "notes": [
                    "Aggregate totals come from no-dimension queries, kept separate from breakdowns.",
                    "Query/page/country/device rows are Google's exposed top rows; anonymized queries are omitted.",
                    "Search types are fetched separately and must not be summed together."]}

    def put(name, data, rows=None):
        save(name, data)
        manifest["datasets"][name] = {"rows": len(rows) if rows is not None else None}
        print(f"  {name}: {len(rows) if rows is not None else 'ok'}")

    # Search types: find which have data, fetch each separately.
    active = []
    for st in SEARCH_TYPES:
        daily = query(site, start, end, ["date"], st)
        # The API zero-fills the date dimension, so row count is not evidence of data.
        live = [r for r in daily if r["clicks"] or r["impressions"]]
        print(f"[{st}] daily rows: {len(daily)}, with activity: {len(live)}")
        if not live:
            manifest["datasets"][f"daily_{st}.json"] = {"rows": 0, "note": "no data for this search type"}
            continue
        active.append(st)
        put(f"daily_{st}.json", daily, daily)
        put(f"totals_{st}.json", {"first_activity": live[0]["keys"][0], "last_activity": live[-1]["keys"][0],
                                  "totals": totals(site, start, end, st)})
    manifest["search_types_with_data"] = active
    if "web" not in active:
        save("manifest.json", manifest)
        print("No web data found for this property in the available window.")
        return

    # Dimensional breakdowns, full history, web first; other types per available dimensions.
    shapes = {"web": [["query"], ["page"], ["query", "page"], ["country"], ["device"]]}
    for st in active:
        if st == "web":
            continue
        # discover/googleNews have no query dimension.
        shapes[st] = [["page"], ["country"], ["device"]] if st in ("discover", "googleNews") \
            else [["query"], ["page"], ["country"], ["device"]]
    for st, dims_list in shapes.items():
        for dims in dims_list:
            rows = query(site, start, end, dims, st)
            put(f"{'_'.join(dims)}_{st}.json", rows, rows)

    # Window comparisons (web): last 28d vs previous 28d, and vs same 28d a year earlier.
    cur_end = end
    cur_start = cur_end - timedelta(days=27)
    prev_end = cur_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=27)
    yoy_start, yoy_end = cur_start - timedelta(days=364), cur_end - timedelta(days=364)
    windows = {"current": (cur_start, cur_end), "previous_28d": (prev_start, prev_end),
               "year_ago": (yoy_start, yoy_end)}
    comp = {"windows": {k: [str(a), str(b)] for k, (a, b) in windows.items()}, "totals": {},
            "comparisons": {}, "breakdown_changes": {}}
    web_daily = json.loads((OUT / "daily_web.json").read_text())
    first_data = date.fromisoformat(
        next(r for r in web_daily if r["clicks"] or r["impressions"])["keys"][0])
    for name, (a, b) in windows.items():
        comp["totals"][name] = totals(site, a, b)
        if a < first_data:
            comp["totals"][name]["coverage"] = f"window starts before first data day {first_data}"
    comp["comparisons"]["28d_vs_previous_28d"] = delta(comp["totals"]["current"], comp["totals"]["previous_28d"])
    if yoy_start >= first_data:
        comp["comparisons"]["28d_vs_year_ago"] = delta(comp["totals"]["current"], comp["totals"]["year_ago"])
    else:
        comp["comparisons"]["28d_vs_year_ago"] = (
            f"unavailable: year-ago window {yoy_start}..{yoy_end} predates first data day {first_data}")
    for dim in ("query", "page", "country", "device"):
        cur = query(site, *windows["current"], [dim])
        prev = query(site, *windows["previous_28d"], [dim])
        comp["breakdown_changes"][f"{dim}_28d_vs_previous_28d"] = keyed_delta(cur, prev)
        if yoy_start >= first_data:
            yoy = query(site, *windows["year_ago"], [dim])
            comp["breakdown_changes"][f"{dim}_28d_vs_year_ago"] = keyed_delta(cur, yoy)
    save("comparisons.json", comp)
    print("  comparisons.json: ok")
    save("manifest.json", manifest)
    print(f"Saved to {OUT}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["sites", "fetch"])
    args = parser.parse_args()
    if args.command == "sites":
        for s in list_sites():
            print(s["siteUrl"], s["permissionLevel"])
    else:
        fetch_all()
