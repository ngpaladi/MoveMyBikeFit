'use strict';

// Bar reach used for all calculations (mm from bar clamp center to hood contact point).
// Not user-adjustable — assumed average road/gravel bar.
const BAR_REACH = 80;

const FitCalculator = {

  // Saddle top position in bike mm coords (BB = origin).
  // setbackMM shifts the saddle horizontally rearward from the seat-tube axis.
  saddlePosition(size, saddleHeightMM, setbackMM = 0) {
    const sta = size.st_angle * Math.PI / 180;
    return {
      x: -Math.cos(sta) * saddleHeightMM - setbackMM,
      y:  Math.sin(sta) * saddleHeightMM,
    };
  },

  // Stem base position, accounting for spacers stacked above HT top along steerer axis.
  // Steerer upward unit vector: (-cos(HTA), sin(HTA))
  stemBase(htTop, htaRad, spacersMM) {
    return {
      x: htTop.x - Math.cos(htaRad) * spacersMM,
      y: htTop.y + Math.sin(htaRad) * spacersMM,
    };
  },

  // Stem direction vector for angle relative to head tube.
  // θ=0  → perpendicular to steerer (roughly forward/horizontal)
  // θ>0  → tilts bars upward
  // θ<0  → tilts bars downward (slammed)
  // Formula: direction = (sin(HTA - θ), cos(HTA - θ))
  stemDirection(htaRad, stemAngleRelHTRad) {
    return {
      x: Math.sin(htaRad - stemAngleRelHTRad),
      y: Math.cos(htaRad - stemAngleRelHTRad),
    };
  },

  // Hood position in bike mm coords
  hoodPosition(size, htTop, stemLengthMM, stemAngleRelHTDeg, spacersMM, barReachMM = BAR_REACH) {
    const hta = size.ht_angle * Math.PI / 180;
    const theta = stemAngleRelHTDeg * Math.PI / 180;
    const base = this.stemBase(htTop, hta, spacersMM);
    const dir  = this.stemDirection(hta, theta);
    return {
      x: base.x + stemLengthMM * dir.x + barReachMM,
      y: base.y + stemLengthMM * dir.y,
    };
  },

  dist(a, b) {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  },

  // Calculate the three touchpoint triangle distances given saddle and hood positions
  triangleDistances(saddlePos, hoodPos) {
    const BB = { x: 0, y: 0 };
    return {
      saddleHeight: this.dist(BB, saddlePos),
      seatToHood:   this.dist(saddlePos, hoodPos),
      hoodToBB:     this.dist(hoodPos, BB),
    };
  },

  // Solve for the stem length + angle (relative to HT) needed to achieve the user's
  // fit triangle. Returns { stemLength, stemAngleDeg, hoodPos } or null if unsolvable.
  findStem(size, htTop, saddleHeightMM, targetSeatToHood, targetHoodToBB, spacersMM = 0, setbackMM = 0, barReachMM = BAR_REACH) {
    const hta = size.ht_angle * Math.PI / 180;
    const BB  = { x: 0, y: 0 };
    const saddle = this.saddlePosition(size, saddleHeightMM, setbackMM);

    // Intersect two circles to find hood position:
    //   circle 1 centered at saddle, r = seatToHood
    //   circle 2 centered at BB,     r = hoodToBB
    const solutions = this._circleIntersections(saddle, targetSeatToHood, BB, targetHoodToBB);
    if (!solutions) return null;

    // Select the solution that is forward of the BB and above wheel level
    const hood = solutions
      .filter(p => p.x > 0 && p.y > -50)
      .sort((a, b) => b.x - a.x)[0];
    if (!hood) return null;

    // Bar clamp = hood - bar reach (horizontally)
    const barClamp = { x: hood.x - barReachMM, y: hood.y };

    // Stem base (HT_top + spacers along steerer)
    const base = this.stemBase(htTop, hta, spacersMM);

    const dx = barClamp.x - base.x;
    const dy = barClamp.y - base.y;
    const stemLength = Math.round(Math.sqrt(dx * dx + dy * dy));

    // Recover stem angle relative to HT:
    //   dx = stemLength * sin(HTA - θ)  →  atan2(dx, dy) = HTA - θ
    const stemAngleDeg = Math.round((hta * 180 / Math.PI) - Math.atan2(dx, dy) * (180 / Math.PI));

    return { stemLength, stemAngleDeg, hoodPos: hood };
  },

  fitScore(actual, target) {
    return Math.round(
      Math.abs(actual.saddleHeight - target.saddleHeight) +
      Math.abs(actual.seatToHood   - target.seatToHood)   +
      Math.abs(actual.hoodToBB     - target.hoodToBB)
    );
  },

  // Estimate rider CoG using a two-segment body model:
  //   legs    (~35%): CoG at midpoint of hip (saddle) and average pedal (BB = origin)
  //   upper   (~65%): CoG at midpoint of hip (saddle) and hands (hood), proxy for torso lean
  riderCoG(saddlePos, hoodPos) {
    const legCoG   = { x: saddlePos.x / 2,                        y: saddlePos.y / 2 };
    const upperCoG = { x: (saddlePos.x + hoodPos.x) / 2,          y: (saddlePos.y + hoodPos.y) / 2 };
    const LEG_FRAC = 0.35;
    return {
      x: LEG_FRAC * legCoG.x + (1 - LEG_FRAC) * upperCoG.x,
      y: LEG_FRAC * legCoG.y + (1 - LEG_FRAC) * upperCoG.y,
    };
  },

  // Fore-aft weight distribution from rider CoG projected onto the wheelbase.
  // Returns { front, rear } as percentages rounded to one decimal.
  weightDistribution(size, cogPos) {
    const rearX  = -Math.sqrt(size.cs_length ** 2 - size.bb_drop ** 2);
    const frontX = rearX + size.wheelbase;
    const front  = Math.round((cogPos.x - rearX) / (frontX - rearX) * 1000) / 10;
    return { front, rear: Math.round((100 - front) * 10) / 10 };
  },

  _circleIntersections(p1, r1, p2, r2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return null;
    const a  = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h2 = r1 * r1 - a * a;
    if (h2 < 0) return null;
    const h  = Math.sqrt(h2);
    const mx = p1.x + a * dx / d, my = p1.y + a * dy / d;
    return [
      { x: mx + h * dy / d, y: my - h * dx / d },
      { x: mx - h * dy / d, y: my + h * dx / d },
    ];
  },
};
