# GPA Calculator SEO data (read-only)

Fetches Google Search Console data for `sc-domain:gpacalculatorfree.com` only.
Scope: `webmasters.readonly`. Credentials stay outside the repo.

```sh
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/noteflux-seo/credentials.json"
uv run --project tools/seo python tools/seo/seo.py sites   # list visible properties
uv run --project tools/seo python tools/seo/seo.py fetch   # writes tools/seo/reports/*.json (gitignored)
```

Output: `daily_<type>.json`, `totals_<type>.json` (aggregates, no dimensions), breakdowns
(`query`, `page`, `query_page`, `country`, `device`), and `comparisons.json` (28d vs previous 28d,
year-over-year when data exists). Search types are fetched separately; never sum them.
Notes: the API zero-fills the date dimension; breakdown rows are Google's exposed top rows only.
