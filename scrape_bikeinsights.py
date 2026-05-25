#!/usr/bin/env python3
"""
Scrape bike geometry from bikeinsights.com and output YAML for _data/bikes/.

Data is embedded in the page as an Apollo GraphQL cache (__NEXT_DATA__).
No JS rendering needed — a plain HTTP GET is sufficient.

Usage:
    python3 scrape_bikeinsights.py <url> [options]

    python3 scrape_bikeinsights.py https://bikeinsights.com/bikes/5cb22fd9f3e7180017975481-canyon-bicycles-grail
    python3 scrape_bikeinsights.py https://bikeinsights.com/bikes/... --type road
    python3 scrape_bikeinsights.py https://bikeinsights.com/bikes/... --out _data/bikes/

Options:
    --type    gravel | road | cx | adventure  (default: gravel)
    --out     Directory to write the .yml file (default: print to stdout)
    --version Year to request, e.g. 2024 (appended as ?version= if not in URL)
    --build   Build slug to request (appended as &build= if not in URL)
"""

import argparse
import gzip
import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}

# Output field order for the YAML sizes block
FIELD_ORDER = [
    "stack", "reach",
    "ht_length", "ht_angle",
    "st_length", "st_angle",
    "tt_length",
    "cs_length", "bb_drop", "wheelbase",
    "front_center", "fork_length", "fork_offset", "standover",
]

ANGLE_FIELDS = {"ht_angle", "st_angle"}


def fetch_html(url: str) -> str:
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", errors="replace")
    except (URLError, HTTPError) as e:
        print(f"Fetch error: {e}", file=sys.stderr)
        sys.exit(1)


def extract_apollo(html: str) -> dict:
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html, re.DOTALL,
    )
    if not m:
        print("ERROR: No __NEXT_DATA__ found in page.", file=sys.stderr)
        sys.exit(1)
    data = json.loads(m.group(1))
    return data["props"].get("apolloState", {})


def deref(apollo: dict, ref_or_val):
    """Resolve a __ref pointer or return the value as-is."""
    if isinstance(ref_or_val, dict) and "__ref" in ref_or_val:
        return apollo.get(ref_or_val["__ref"], {})
    return ref_or_val


def first_non_null(*values):
    for v in values:
        if v is not None:
            return v
    return None


def parse_meta(apollo: dict) -> dict:
    """Extract brand, model, year from Apollo cache."""
    rq = apollo.get("ROOT_QUERY", {})

    # Find the bike({...}) query
    bike_ref = None
    version_slug = None
    for k, v in rq.items():
        if k.startswith("bike(") and isinstance(v, dict) and "__ref" in v:
            bike_ref = v["__ref"]
        if k.startswith("bikeProfile("):
            m = re.search(r'"bikeVersionSlug"\s*:\s*"([^"]+)"', k)
            if m:
                version_slug = m.group(1)

    bike = apollo.get(bike_ref, {}) if bike_ref else {}
    brand = deref(apollo, bike.get("brand", {}))

    return {
        "brand": brand.get("name", ""),
        "model": bike.get("name", ""),
        "year": _version_to_year(version_slug or ""),
    }


def _version_to_year(slug: str) -> int | str:
    m = re.search(r"\d{4}", slug)
    return int(m.group(0)) if m else slug or ""


def parse_geometries(apollo: dict) -> list[dict]:
    """Extract BikeGeometry objects, deduplicated by size label."""
    entries = []
    for key, obj in apollo.items():
        if not key.startswith("BikeGeometry:"):
            continue
        if not obj.get("published", True):
            continue
        size = _parse_geometry(obj)
        if size:
            entries.append((obj.get("sort_value", ""), key, size))

    entries.sort(key=lambda x: x[0])

    # Deduplicate by label: for each label, keep the entry with the most
    # non-None frame raw values (most complete manufacturer data).
    seen: dict[str, tuple[int, dict]] = {}
    for _, key, size in entries:
        label = size["label"]
        score = len(size)  # more fields = more complete
        if label not in seen or score > seen[label][0]:
            seen[label] = (score, size)

    # Re-sort by original sort_value order
    label_order = []
    for _, _, size in entries:
        lbl = size["label"]
        if lbl not in label_order:
            label_order.append(lbl)

    return [seen[lbl][1] for lbl in label_order]


def _parse_geometry(geo: dict) -> dict | None:
    label = geo.get("size", "")
    if not label:
        return None

    frame = geo.get("frame") or {}
    fork = geo.get("fork") or {}
    build = geo.get("base_build") or {}
    calc_frame = (geo.get("calculated") or {}).get("frame") or {}
    calc_fork = (geo.get("calculated") or {}).get("fork") or {}

    out = {"label": str(label).strip()}

    def mm(val):
        return int(round(float(val))) if val is not None else None

    def deg(val):
        return round(float(val), 1) if val is not None else None

    # Stack / Reach
    _set(out, "stack", mm(first_non_null(frame.get("stack"), calc_frame.get("stack"))))
    _set(out, "reach", mm(first_non_null(frame.get("reach"), calc_frame.get("reach"))))

    # Head tube
    _set(out, "ht_length", mm(frame.get("head_tube_length")))
    _set(out, "ht_angle", deg(frame.get("head_tube_angle")))

    # Seat tube — prefer C-T (center-to-top), fall back to unknown
    st_raw = first_non_null(
        frame.get("seat_tube_length_center_tt_top"),
        frame.get("seat_tube_length_center_st_top"),
        frame.get("seat_tube_length_unknown"),
        calc_frame.get("seat_tube_length_center_tt_top"),
        calc_frame.get("seat_tube_length_center_st_top"),
    )
    _set(out, "st_length", mm(st_raw))

    # Seat tube angle — prefer nominal, fall back to effective
    sta_raw = first_non_null(
        frame.get("seat_tube_angle"),
        frame.get("seat_tube_angle_unknown"),
        frame.get("effective_seat_tube_angle_unknown"),
    )
    _set(out, "st_angle", deg(sta_raw))

    # Effective top tube
    ett_raw = first_non_null(
        frame.get("effective_top_tube_length_center_ht_top"),
        frame.get("effective_top_tube_length_center_center"),
        frame.get("effective_top_tube_length_unknown"),
        frame.get("top_tube_length_center_center"),
        frame.get("top_tube_length_unknown"),
        calc_frame.get("effective_top_tube_length_center_ht_top"),
        calc_frame.get("effective_top_tube_length_center_center"),
        calc_frame.get("effective_top_tube_length_unknown"),
    )
    _set(out, "tt_length", mm(ett_raw))

    # Chainstay / BB drop / wheelbase
    _set(out, "cs_length", mm(frame.get("chainstay_length")))
    _set(out, "bb_drop", mm(frame.get("bottom_bracket_drop")))
    _set(out, "wheelbase", mm(first_non_null(frame.get("wheelbase"), calc_frame.get("wheelbase"))))

    # Front center — prefer raw frame value, fall back to calculated
    fc = first_non_null(frame.get("front_center"), calc_frame.get("front_center"))
    _set(out, "front_center", mm(fc))

    # Fork — prefer raw, fall back to calculated
    fork_offset = first_non_null(fork.get("offset"), calc_fork.get("offset"))
    _set(out, "fork_offset", mm(fork_offset))

    fork_len = first_non_null(
        fork.get("axle_to_crown_distance"),
        fork.get("length"),
        fork.get("length_unknown"),
        calc_fork.get("axle_to_crown_distance"),
        calc_fork.get("length"),
    )
    _set(out, "fork_length", mm(fork_len))

    # Standover
    _set(out, "standover", mm(build.get("standover_height")))

    # Must have stack + reach to be useful
    if "stack" not in out or "reach" not in out:
        return None

    return out


def _set(d: dict, key: str, val):
    if val is not None:
        d[key] = val


def infer_type(apollo: dict) -> str:
    """Infer bike type from BikeBuild.level_3_category (most specific)."""
    # Find the active BikeBuild from ROOT_QUERY bikeProfile
    rq = apollo.get("ROOT_QUERY", {})
    profile_key = next(
        (k for k in rq if k.startswith("bikeProfile(")), None
    )
    if profile_key:
        profile = deref(apollo, rq[profile_key])
        build = deref(apollo, profile.get("bike_build", {}))
        cat = deref(apollo, build.get("level_3_category", {}))
        if cat:
            return _category_to_type(cat.get("slug", ""), cat.get("name", ""))

    # Fallback: scan all BikeBuild objects
    for key, obj in apollo.items():
        if key.startswith("BikeBuild:"):
            cat = deref(apollo, obj.get("level_3_category", {}))
            if cat:
                return _category_to_type(cat.get("slug", ""), cat.get("name", ""))

    return "gravel"


def _category_to_type(slug: str, name: str) -> str:
    s = (slug + " " + name).lower()
    if "gravel" in s or "mixed-terrain" in s:
        return "gravel"
    if "cyclocross" in s or " cx" in s:
        return "cx"
    if "adventure" in s or "all-road" in s or "all road" in s:
        return "adventure"
    if "road" in s or "endurance" in s:
        return "road"
    return "gravel"


def to_yaml(brand: str, model: str, year, bike_type: str, sizes: list[dict]) -> str:
    lines = [
        f"brand: {brand}",
        f"model: {model}",
        f"year: {year}",
        f"type: {bike_type}",
        "sizes:",
    ]
    for s in sizes:
        label = s["label"]
        # Quote numeric-only labels so YAML doesn't parse them as numbers
        if re.match(r"^\d+$", label):
            lines.append(f'  - label: "{label}"')
        else:
            lines.append(f"  - label: {label}")
        for field in FIELD_ORDER:
            if field in s:
                lines.append(f"    {field}: {s[field]}")
    return "\n".join(lines) + "\n"


def slugify(brand: str, model: str, year) -> str:
    raw = f"{brand}-{model}-{year}"
    return re.sub(r"[^a-zA-Z0-9]+", "-", raw).lower().strip("-") + ".yml"


def build_url(base: str, version: str | None, build: str | None) -> str:
    params = {}
    parsed = urlparse(base)
    existing = parsed.query
    if version and "version=" not in existing:
        params["version"] = version
    if build and "build=" not in existing:
        params["build"] = build
    if params:
        sep = "&" if existing else "?"
        return base + sep + urlencode(params)
    return base


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="bikeinsights.com bike URL")
    parser.add_argument("--type", default=None, choices=["gravel", "road", "cx", "adventure"],
                        help="Bike type (auto-detected if omitted)")
    parser.add_argument("--out", metavar="DIR",
                        help="Output directory (default: print to stdout)")
    parser.add_argument("--version", metavar="YEAR",
                        help="Model year to append as ?version= query param")
    parser.add_argument("--build", metavar="SLUG",
                        help="Build slug to append as &build= query param")
    args = parser.parse_args()

    if "bikeinsights.com" not in args.url:
        print("Warning: URL doesn't look like bikeinsights.com", file=sys.stderr)

    url = build_url(args.url, args.version, args.build)
    print(f"Fetching {url} ...", file=sys.stderr)

    html = fetch_html(url)
    apollo = extract_apollo(html)

    meta = parse_meta(apollo)
    if not meta["brand"] or not meta["model"]:
        # Try to guess from URL slug: ".../id-brand-model" → last two words
        slug_part = urlparse(url).path.split("/")[-1]
        parts = slug_part.split("-")
        if len(parts) > 2:
            meta["brand"] = parts[1].title()
            meta["model"] = " ".join(p.title() for p in parts[2:])

    bike_type = args.type or infer_type(apollo)
    sizes = parse_geometries(apollo)

    if not sizes:
        print("ERROR: No geometry data found in page.", file=sys.stderr)
        print("Check the URL or try adding --version YEAR.", file=sys.stderr)
        sys.exit(1)

    print(
        f"Extracted {len(sizes)} sizes for "
        f"{meta['brand']} {meta['model']} {meta['year']}",
        file=sys.stderr,
    )

    yaml_str = to_yaml(meta["brand"], meta["model"], meta["year"], bike_type, sizes)

    if args.out:
        from pathlib import Path
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / slugify(meta["brand"], meta["model"], meta["year"])
        path.write_text(yaml_str)
        print(f"Written to {path}", file=sys.stderr)
    else:
        print(yaml_str)


if __name__ == "__main__":
    main()
