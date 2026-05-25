# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Serve locally (requires Ruby + bundler)
bundle install
bundle exec jekyll serve --livereload

# The site is at http://localhost:4000/mmbf/
# bikes.json is served at http://localhost:4000/mmbf/bikes.json
```

GitHub Pages builds Jekyll automatically on push. No manual build step needed.

## Architecture

**Jekyll + vanilla JS static site, hosted on GitHub Pages.**

```
_data/bikes/*.yml     → source of truth for all bike geometry
bikes.json            → Jekyll Liquid page that serializes _data/bikes/ to JSON
assets/js/            → four vanilla-JS modules loaded in index.html
index.html            → main comparison tool (Jekyll layout + inline DOM)
add.html              → geometry input form (no server needed, client-side YAML export)
```

### Data flow

1. `bikes.json` is rendered by Jekyll at build time: `{{ site.data.bikes | jsonify }}`
2. `BikeStore.js` fetches `/mmbf/bikes.json` (BASE_URL auto-detected from script src)
3. `app.js` manages state (selected bikes, fit measurements, cockpit inputs)
4. `BikeRenderer.js` draws SVG from bike geometry points
5. `FitCalculator.js` does the touchpoint math (circle intersections for stem finder)

### Geometry coordinate system

All calculations use **mm** with BB at origin:
- X positive = forward (toward front wheel)
- Y positive = upward
- SVG Y is flipped in `BikeRenderer._calcTransform()`

Key derived points:
- `HT_top = (reach, stack)` — the canonical Stack/Reach definition
- `HT_bottom = HT_top + (cos(HTA)·HTL, −sin(HTA)·HTL)` — head tube goes forward+down
- `ST_top = (−cos(STA)·STL, sin(STA)·STL)` — seat tube goes backward+up from BB
- `rear_axle.x = −sqrt(CS²−BBdrop²)`, `rear_axle.y = BBdrop`
- `front_axle.x = rear_axle.x + wheelbase`

### Fit triangle

Three user measurements define a triangle:
1. **BB → Saddle** (`saddleHeight`): distance along seat-tube direction
2. **Saddle → Hoods** (`seatToHood`): straight-line distance
3. **Hoods → BB** (`hoodToBB`): straight-line distance

`FitCalculator.findStem()` solves for stem length via two-circle intersection (saddle circle ∩ BB circle → hood position → invert through bar reach → stem vector from HT_top).

### Adding bike geometry (YAML schema)

Files in `_data/bikes/` use this schema (all angles in degrees from horizontal, all lengths in mm):

```yaml
brand: Specialized
model: Crux
year: 2024
type: gravel        # gravel | road | cx | adventure
sizes:
  - label: "54"
    stack: 560       # BB center → HT top, vertical
    reach: 388       # BB center → HT top, horizontal
    ht_length: 130   # head tube length
    ht_angle: 71.0   # head tube angle from horizontal
    st_length: 510   # seat tube length, C-T
    st_angle: 74.0   # seat tube angle from horizontal (effective)
    tt_length: 580   # effective top tube length (reference only)
    cs_length: 420   # chainstay length
    bb_drop: 65      # BB below axle centerline
    wheelbase: 1004
    front_center: 589  # optional, can be derived
    fork_length: 374   # optional, axle to crown
    fork_offset: 47    # optional, fork rake
    standover: 810     # optional
```

Geometry values come from official manufacturer pages. Include the source URL in the PR description.

### Module responsibilities

| File | Responsibility |
|------|---------------|
| `BikeRenderer.js` | SVG drawing — takes geometry points, outputs `<g>` elements per bike |
| `FitCalculator.js` | Pure math — saddle/hood positions, circle intersections, fit scoring |
| `BikeStore.js` | Data layer — load, cache, search/filter bikes from JSON |
| `app.js` | UI orchestration — state, DOM events, persistence, binds the other three |

State persistence: `localStorage` (key: `mmbf-state`) + URL query params for sharing. URL params take precedence over localStorage on load.
