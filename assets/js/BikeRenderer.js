'use strict';

const WHEEL_RADIUS = 330;    // mm, 700c + ~40mm gravel tire
const TIRE_WIDTH   = 38;     // mm visual stroke width
const HUB_RADIUS   = 18;     // mm
const BB_RADIUS    = 22;     // mm

const TUBE_W = {
  downTube:   18,
  topTube:    13,
  seatTube:   13,
  headTube:   22,
  chainstay:  10,
  seatstay:    8,
  fork:       10,
  seatpost:   20,
  stem:       12,
};

const BIKE_COLORS = ['#58a6ff', '#f78166'];

class BikeRenderer {
  constructor(svgEl) {
    this.svg = svgEl;
    this.bikes = [];   // [{id, geo, size, colorIdx, stemLength, stemAngle, spacers}]
    this.fit = null;   // {saddleHeight, seatToHood, hoodToBB}
    this.padding = 55;
    this._resizeObs = new ResizeObserver(() => this.render());
    this._resizeObs.observe(svgEl);
  }

  destroy() { this._resizeObs.disconnect(); }

  setBikes(bikes) {
    this.bikes = bikes.map((b, i) => ({ ...b, colorIdx: b.colorIdx ?? i % BIKE_COLORS.length }));
    this.render();
  }

  setFit(fit) { this.fit = fit; this.render(); }

  render() {
    const svg = this.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!this.bikes.length) return;

    const W = svg.clientWidth  || 800;
    const H = svg.clientHeight || 500;

    const allPoints = this.bikes.map(b => ({
      ...b,
      pts: this._calcPoints(b.size),
    }));

    const tr = this._calcTransform(allPoints, W, H);

    // draw order: wheels → frames → recommended overlay (grey) → cockpit → fit overlay → hubs/BBs
    const wheelGroup   = this._g(svg);
    const frameGroup   = this._g(svg);
    const recGroup     = this._g(svg);
    const cockpitGroup = this._g(svg);
    const fitGroup     = this._g(svg);
    const topGroup     = this._g(svg);

    allPoints.forEach(b => {
      const color = BIKE_COLORS[b.colorIdx];
      this._drawWheels(wheelGroup, b.pts, tr, color);
      this._drawFrame(frameGroup, b.pts, tr, color, b);
      if (this.fit && this.fit.saddleHeight && b.recommendedHood) {
        this._drawRecommendedOverlay(recGroup, b.pts, tr, b, this.fit);
      }
      if (b.stemLength) this._drawCockpit(cockpitGroup, b.pts, tr, color, b);
      if (this.fit && this.fit.saddleHeight) {
        this._drawFitOverlay(fitGroup, b.pts, tr, color, b, this.fit);
      }
      this._drawHubs(topGroup, b.pts, tr, color);
      this._drawBB(topGroup, b.pts.BB, tr, color);
    });

    this._drawLegend(svg, allPoints, W);
  }

  // ── Geometry calculation ───────────────────────────────────────────────────

  _calcPoints(size) {
    const hta = size.ht_angle * Math.PI / 180;
    const sta = size.st_angle * Math.PI / 180;

    const BB = { x: 0, y: 0 };

    const HT_top = { x: size.reach, y: size.stack };

    // Head tube bottom: forward by cos(hta)*len, down by sin(hta)*len
    const HT_bottom = {
      x: HT_top.x + Math.cos(hta) * size.ht_length,
      y: HT_top.y - Math.sin(hta) * size.ht_length,
    };

    // Seat tube top: backward/upward from BB at seat tube angle
    const ST_top = {
      x: -Math.cos(sta) * size.st_length,
      y:  Math.sin(sta) * size.st_length,
    };

    // Rear axle: BB is bb_drop below axle level
    const cs  = size.cs_length;
    const bbd = size.bb_drop;
    const rear_axle = {
      x: -Math.sqrt(Math.max(0, cs * cs - bbd * bbd)),
      y: bbd,
    };

    // Front axle: wheelbase from rear axle
    const front_axle = { x: rear_axle.x + size.wheelbase, y: bbd };

    return { BB, HT_top, HT_bottom, ST_top, rear_axle, front_axle };
  }

  _calcTransform(allBikes, W, H) {
    const pts = [];
    allBikes.forEach(({ pts: p, size, stemLength, stemAngle, spacers, barReach, setback, recommendedHood }) => {
      pts.push({ x: p.rear_axle.x  - WHEEL_RADIUS, y: p.rear_axle.y  - WHEEL_RADIUS });
      pts.push({ x: p.rear_axle.x  + WHEEL_RADIUS, y: p.rear_axle.y  + WHEEL_RADIUS });
      pts.push({ x: p.front_axle.x - WHEEL_RADIUS, y: p.front_axle.y - WHEEL_RADIUS });
      pts.push({ x: p.front_axle.x + WHEEL_RADIUS, y: p.front_axle.y + WHEEL_RADIUS });
      pts.push(p.HT_top);
      pts.push(p.ST_top);

      // Include saddle position when fit is active (can extend well above ST_top)
      if (this.fit?.saddleHeight) {
        const sta = size.st_angle * Math.PI / 180;
        pts.push({
          x: -Math.cos(sta) * this.fit.saddleHeight - (setback || 0),
          y:  Math.sin(sta) * this.fit.saddleHeight,
        });
      }

      // Include ideal hood position (always shown when fit is active)
      if (recommendedHood) pts.push(recommendedHood);

      // Include actual hood position when cockpit is set (bars can extend past front wheel)
      if (stemLength) {
        const hta   = size.ht_angle * Math.PI / 180;
        const theta = (stemAngle || 0) * Math.PI / 180;
        const sp    = spacers || 0;
        const base  = {
          x: p.HT_top.x - Math.cos(hta) * sp,
          y: p.HT_top.y + Math.sin(hta) * sp,
        };
        pts.push({
          x: base.x + stemLength * Math.sin(hta - theta) + (barReach || 80),
          y: base.y + stemLength * Math.cos(hta - theta),
        });
      }
    });

    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const pad = this.padding;
    const scale = Math.min(
      (W - 2 * pad) / (maxX - minX),
      (H - 2 * pad) / (maxY - minY)
    );

    const totalW = (maxX - minX) * scale;
    const totalH = (maxY - minY) * scale;
    const ox = (W - totalW) / 2 - minX * scale;
    const oy = H - (H - totalH) / 2 + minY * scale;

    const tr = p => ({ x: p.x * scale + ox, y: oy - p.y * scale });
    tr.scale = scale;
    return tr;
  }

  // ── Drawing primitives ─────────────────────────────────────────────────────

  _g(parent, attrs = {}) {
    const el = this._el('g', attrs);
    parent.appendChild(el);
    return el;
  }

  _el(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  _circle(parent, c, rMM, fill = 'none', fillOp = 1, stroke = 'none', strokeWMM = 0, strokeOp = 1) {
    const s = this._currentScale || 1;
    parent.appendChild(this._el('circle', {
      cx: c.x, cy: c.y, r: rMM * s,
      fill, 'fill-opacity': fillOp,
      stroke, 'stroke-width': strokeWMM * s, 'stroke-opacity': strokeOp,
    }));
  }

  _tube(parent, a, b, color, widthMM, opacity = 0.85) {
    const s = this._currentScale || 1;
    parent.appendChild(this._el('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: color, 'stroke-width': widthMM * s,
      'stroke-linecap': 'round', opacity,
    }));
  }

  _path(parent, d, fill, fillOp, stroke = 'none', strokeW = 0, op = 1) {
    parent.appendChild(this._el('path', {
      d, fill, 'fill-opacity': fillOp,
      stroke, 'stroke-width': strokeW, opacity: op,
    }));
  }

  _text(parent, txt, x, y, fontSize, fill, anchor = 'start') {
    const el = this._el('text', {
      x, y, 'font-size': fontSize, fill, 'text-anchor': anchor,
      'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    el.textContent = txt;
    parent.appendChild(el);
  }

  // ── Component drawing ──────────────────────────────────────────────────────

  _drawWheels(g, pts, tr, color) {
    this._currentScale = tr.scale;
    const s = tr.scale;
    const rear = tr(pts.rear_axle), front = tr(pts.front_axle);

    for (const center of [rear, front]) {
      // Tire
      this._circle(g, center, WHEEL_RADIUS, 'none', 1, color, TIRE_WIDTH, 0.25);
      // Rim
      this._circle(g, center, WHEEL_RADIUS - TIRE_WIDTH / 2, 'none', 1, color, 3, 0.45);
      // Inner rim
      this._circle(g, center, WHEEL_RADIUS - TIRE_WIDTH - 2, 'none', 1, color, 1.5, 0.2);
    }
  }

  _drawHubs(g, pts, tr, color) {
    this._currentScale = tr.scale;
    const rear = tr(pts.rear_axle), front = tr(pts.front_axle);
    for (const c of [rear, front]) {
      this._circle(g, c, HUB_RADIUS, color, 0.9);
      this._circle(g, c, HUB_RADIUS * 0.45, '#0d1117', 1);
    }
  }

  _drawBB(g, BB, tr, color) {
    this._currentScale = tr.scale;
    const c = tr(BB);
    this._circle(g, c, BB_RADIUS, color, 0.85);
    this._circle(g, c, BB_RADIUS * 0.5, '#0d1117', 1);
  }

  _drawFrame(g, pts, tr, color, b) {
    this._currentScale = tr.scale;
    const { BB, HT_top, HT_bottom, ST_top, rear_axle } = pts;
    const t = p => tr(p);

    // Chainstays (offset slightly for dual-stay look)
    const cs_perp = this._perpOffset(BB, rear_axle, 6);
    this._tube(g, t({ x: BB.x + cs_perp.dx, y: BB.y + cs_perp.dy }),
                  t({ x: rear_axle.x + cs_perp.dx, y: rear_axle.y + cs_perp.dy }),
                  color, TUBE_W.chainstay, 0.8);
    this._tube(g, t({ x: BB.x - cs_perp.dx, y: BB.y - cs_perp.dy }),
                  t({ x: rear_axle.x - cs_perp.dx, y: rear_axle.y - cs_perp.dy }),
                  color, TUBE_W.chainstay * 0.8, 0.6);

    // Seat stays
    this._tube(g, t(ST_top), t(rear_axle), color, TUBE_W.seatstay, 0.75);

    // Main tubes
    this._tube(g, t(BB), t(ST_top),    color, TUBE_W.seatTube,  0.85);
    this._tube(g, t(BB), t(HT_bottom), color, TUBE_W.downTube,  0.85);
    this._tube(g, t(ST_top), t(HT_top), color, TUBE_W.topTube,  0.85);
    this._tube(g, t(HT_top), t(HT_bottom), color, TUBE_W.headTube, 0.9);

    // Fork
    this._tube(g, t(HT_bottom), t(pts.front_axle), color, TUBE_W.fork, 0.8);
  }

  _drawCockpit(g, pts, tr, color, b) {
    this._currentScale = tr.scale;
    const hta       = b.size.ht_angle * Math.PI / 180;
    const theta     = (b.stemAngle || 0) * Math.PI / 180;  // relative to HT
    const stemLen   = b.stemLength || 100;
    const spacers   = b.spacers || 0;

    // Steerer upward direction: (-cos(HTA), sin(HTA))
    const stemBase = {
      x: pts.HT_top.x - Math.cos(hta) * spacers,
      y: pts.HT_top.y + Math.sin(hta) * spacers,
    };

    // Draw spacer stack (if any) as a thicker section on the steerer
    if (spacers > 2) {
      this._tube(g, tr(pts.HT_top), tr(stemBase), color, 24, 0.55);
    }

    // Stem direction relative to HT: (sin(HTA - θ), cos(HTA - θ))
    const dirX = Math.sin(hta - theta);
    const dirY = Math.cos(hta - theta);

    const barClamp = {
      x: stemBase.x + stemLen * dirX,
      y: stemBase.y + stemLen * dirY,
    };

    this._tube(g, tr(stemBase), tr(barClamp), color, TUBE_W.stem, 0.9);
    this._drawDropBar(g, tr(barClamp), color, tr.scale, b.barReach || 80);
  }

  // Generic drop bar: bar clamp → top section → bezier drops → hood bump
  _drawDropBar(g, barClampSVG, color, scale, barReachMM = 80) {
    const reach    = barReachMM * scale;
    const dropH    = 125 * scale;
    const hoodX    = barClampSVG.x + reach;
    const hoodY    = barClampSVG.y;
    const dropTipX = hoodX + 14 * scale;
    const dropTipY = hoodY + dropH * 0.62;

    // Top section (bar clamp → hood)
    this._tube(g, barClampSVG, { x: hoodX, y: hoodY }, color, 10, 0.8);

    // Drop curve as cubic bezier
    const path = this._el('path', {
      d: `M ${hoodX},${hoodY} C ${hoodX + 18 * scale},${hoodY + dropH * 0.32} ${hoodX + 22 * scale},${hoodY + dropH * 0.52} ${dropTipX},${dropTipY}`,
      stroke: color, 'stroke-width': 9 * scale,
      fill: 'none', 'stroke-linecap': 'round', opacity: 0.8,
    });
    g.appendChild(path);

    // Hood bump (ellipse representing brake hood from side)
    g.appendChild(this._el('ellipse', {
      cx: hoodX - 5 * scale,
      cy: hoodY + 9 * scale,
      rx: 15 * scale, ry: 12 * scale,
      fill: color, 'fill-opacity': 0.65,
    }));

    // Bar clamp detail
    this._circle(g, barClampSVG, 10, color, 0.9);
    this._circle(g, barClampSVG,  5, '#0d1117', 1);
  }

  _drawFitOverlay(g, pts, tr, color, b, fit) {
    this._currentScale = tr.scale;
    const sta     = b.size.st_angle * Math.PI / 180;
    const setback = b.setback || 0;

    const seatpostTop = {
      x: -Math.cos(sta) * fit.saddleHeight,
      y:  Math.sin(sta) * fit.saddleHeight,
    };
    const saddlePos = { x: seatpostTop.x - setback, y: seatpostTop.y };

    if (fit.saddleHeight > b.size.st_length) {
      this._tube(g, tr(pts.ST_top), tr(seatpostTop), color, TUBE_W.seatpost, 0.7);
    }

    this._drawSaddle(g, tr(saddlePos), color, tr.scale, sta);
  }

  _drawRecommendedOverlay(g, pts, tr, b, fit) {
    this._currentScale = tr.scale;
    const sta     = b.size.st_angle * Math.PI / 180;
    const setback = b.setback || 0;
    const color   = BIKE_COLORS[b.colorIdx];

    const saddlePos = {
      x: -Math.cos(sta) * fit.saddleHeight - setback,
      y:  Math.sin(sta) * fit.saddleHeight,
    };

    const BB_svg   = tr(pts.BB);
    const sad_svg  = tr(saddlePos);
    const hood_svg = tr(b.recommendedHood);

    // Color-coded dashed fit shadow (ideal hood position)
    const d = `M ${BB_svg.x},${BB_svg.y} L ${sad_svg.x},${sad_svg.y} L ${hood_svg.x},${hood_svg.y} Z`;
    g.appendChild(this._el('path', {
      d,
      fill: color,
      'fill-opacity': 0.07,
      stroke: color,
      'stroke-width': 1.5 * tr.scale,
      'stroke-dasharray': `${6 * tr.scale} ${4 * tr.scale}`,
      opacity: 0.55,
    }));

    // Ideal hood position marker
    g.appendChild(this._el('circle', {
      cx: hood_svg.x, cy: hood_svg.y,
      r: 7 * tr.scale,
      fill: color, 'fill-opacity': 0.4,
      stroke: color, 'stroke-width': 1.5 * tr.scale,
      opacity: 0.75,
    }));
  }

  _drawSaddle(g, svgPos, color, scale, staRad) {
    const w = 120 * scale, h = 22 * scale;
    const angleDeg = (90 - staRad * 180 / Math.PI) * 0.08; // slight tilt
    const rx = svgPos.x - w * 0.4, ry = svgPos.y - h / 2;
    const rect = this._el('rect', {
      x: rx, y: ry, width: w, height: h,
      rx: h / 2, ry: h / 2,
      fill: color, 'fill-opacity': 0.9,
      transform: `rotate(${angleDeg}, ${svgPos.x}, ${svgPos.y})`,
    });
    g.appendChild(rect);
  }

  _drawLegend(svg, allBikes, W) {
    if (!allBikes.length) return;
    const g = this._g(svg);
    const pad = 10, lineH = 20, titleH = 16;
    const w = 170, itemH = lineH * allBikes.length + titleH + pad * 2;
    const x = W - w - 10, y = 10;

    g.appendChild(this._el('rect', {
      x, y, width: w, height: itemH,
      fill: 'rgba(22,27,34,0.88)', stroke: '#30363d', 'stroke-width': 1, rx: 6,
    }));

    allBikes.forEach((b, i) => {
      const color = BIKE_COLORS[b.colorIdx];
      const ly = y + pad + titleH + i * lineH;
      g.appendChild(this._el('rect', {
        x: x + pad, y: ly - 5, width: 20, height: 4, rx: 2, fill: color,
      }));
      const label = `${b.geo.brand} ${b.geo.model} ${b.size.label}`;
      this._text(g, label, x + pad + 26, ly, 11, '#e6edf3');
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _perpOffset(a, b, distMM) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { dx: (-dy / len) * distMM, dy: (dx / len) * distMM };
  }
}
