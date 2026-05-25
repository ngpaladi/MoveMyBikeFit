# MoveMyBikeFit

A gravel bike geometry comparison and fit tool. Overlay frame silhouettes side by side, enter your fit triangle measurements to find stem and saddle combinations, and browse raw geometry data across 34 bikes.

**[Open the tool →](https://noahpaladino.com/MoveMyBikeFit/)**

## Features

- **Geometry overlay** — compare up to two frames drawn to scale from stack/reach/chainstay/etc.
- **Fit calculator** — enter BB→Saddle, Saddle→Hoods, and Hoods→BB distances; the tool solves for stem length, stem angle, spacer stack, saddle height, and setback combinations that match your triangle
- **Fit adjustments** — ranks options by least sum-of-squares error, surfaces saddle height and setback tweaks alongside stem combos
- **Auto size** — picks the best frame size for your fit measurements automatically
- **Geometry table** — full per-size data for all loaded bikes

> Measurements must be taken in the plane of the frame. The calculator is 2D and does not account for handlebar width.

## Running locally

Requires Ruby and Bundler.

```bash
bundle install
bundle exec jekyll serve --livereload
# → http://localhost:4000/MoveMyBikeFit/
```

## Adding a bike

1. Fork this repository.
2. Go to **Add Bike** in the nav, paste geometry from the manufacturer's spec page, and download the generated YAML.
3. Drop the file into `_data/bikes/` named `{brand}-{model}-{year}.yml` (lowercase, spaces as hyphens).
4. Open a pull request. Include the source URL for the geometry data in the PR description.

Geometry values must come from the official manufacturer website or press kit. All lengths in mm, angles in degrees from horizontal.

```yaml
brand: Specialized
model: Crux
year: 2024
type: gravel        # gravel | road | cx | adventure
sizes:
  - label: "54"
    stack: 560
    reach: 388
    ht_length: 130
    ht_angle: 71.0
    st_length: 510
    st_angle: 74.0
    tt_length: 580
    cs_length: 420
    bb_drop: 65
    wheelbase: 1004
    fork_length: 374   # optional
    fork_offset: 47    # optional
    standover: 810     # optional
```

## Architecture

Jekyll static site hosted on GitHub Pages. No build-time server or database.

```
_data/bikes/*.yml   — geometry source of truth
bikes.json          — Jekyll serializes _data/bikes/ to JSON at build time
assets/js/
  BikeStore.js      — loads and searches bikes.json
  BikeRenderer.js   — draws SVG frames from geometry points
  FitCalculator.js  — fit triangle math and stem/saddle solver
  app.js            — UI state, events, localStorage persistence
```

State is saved to `localStorage` and encoded in the URL for sharing.

## License

MIT
