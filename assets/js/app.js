'use strict';

// ── Unit conversion ───────────────────────────────────────────────────────────

const UNIT_CFG = {
  cm: {
    toMM:   v => v * 10,
    fromMM: v => parseFloat((v / 10).toFixed(1)),
    step: 0.5,
    suffix: 'cm',
    fitRanges: {
      saddleHeight: { min: 50,   max: 90  },
      seatToHood:   { min: 40,   max: 80  },
      hoodToBB:     { min: 50,   max: 90  },
    },
  },
  in: {
    toMM:   v => v * 25.4,
    fromMM: v => parseFloat((v / 25.4).toFixed(1)),
    step: 0.1,
    suffix: 'in',
    fitRanges: {
      saddleHeight: { min: 19.7, max: 35.4 },
      seatToHood:   { min: 15.7, max: 31.5 },
      hoodToBB:     { min: 19.7, max: 35.4 },
    },
  },
};

// ── Cockpit field definitions ─────────────────────────────────────────────────

const COCKPIT_FIELDS = [
  { key: 'stemLength', label: 'Stem',          unit: 'mm',         min: 40,  max: 140, step: 10, nullable: true },
  { key: 'stemAngle',  label: 'Stem angle',    unit: '° (−=lower)',min: -17, max: 17,  step: 1,  def: 0         },
  { key: 'spacers',    label: 'Spacers',        unit: 'mm',         min: 0,   max: 40,  step: 5,  def: 0         },
  { key: 'barReach',   label: 'Bar reach',      unit: 'mm',         min: 50,  max: 110, step: 5,  def: 80        },
  { key: 'hoodLength', label: 'Hood length',    unit: 'mm',         min: 0,   max: 60,  step: 5,  def: 0         },
  { key: 'setback',    label: 'Saddle setback', unit: 'mm',         min: -40, max: 40,  step: 1,  def: 0         },
];

function defaultCockpit() {
  return { stemLength: null, stemAngle: 0, spacers: 0, setback: 0, barReach: 80, hoodLength: 0 };
}

// ── State ─────────────────────────────────────────────────────────────────────

const MAX_SELECTED = 2;
const MAX_RECENT   = 8;

const state = {
  selectedBikes: new Map(), // bikeId → { sizeIdx, cockpit: { stemLength, stemAngle, spacers, setback, barReach, hoodLength } }
  colorMap:      new Map(), // bikeId → colorIdx
  nextColorIdx:  0,
  recentBikes:   [],        // [bikeId, ...] most-recent-first

  // Personal fit measurements — stored internally in mm
  fit: { saddleHeight: null, seatToHood: null, hoodToBB: null },

  unit: 'cm',  // 'cm' | 'in'
};

// ── DOM / base URL ────────────────────────────────────────────────────────────

const BASE_URL = (() => {
  for (const s of document.querySelectorAll('script[src]')) {
    const m = s.src.match(/^(.*?)\/assets\/js\/app\.js/);
    if (m) return m[1];
  }
  return '';
})();

function $(sel) { return document.querySelector(sel); }

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const svgEl = $('#bike-svg');
  window._renderer = new BikeRenderer(svgEl);

  try {
    await BikeStore.load(BASE_URL);
  } catch (e) {
    showError('Could not load bike data.');
    return;
  }

  renderBikeList(BikeStore.getAll());
  bindSearch();
  bindFitInputs();
  bindUnitToggle();
  bindMobileNav();
  bindResizeHandles();
  restoreState();
}

// ── Bike list ─────────────────────────────────────────────────────────────────

function renderBikeList(bikes) {
  const container = $('#bike-list-inner');
  container.innerHTML = '';

  const recentVisible = state.recentBikes.filter(id => {
    const b = BikeStore.getById(id);
    return b && !state.selectedBikes.has(id);
  });
  if (recentVisible.length) {
    const hdr = document.createElement('div');
    hdr.className = 'bike-group-header';
    hdr.textContent = 'Recent';
    container.appendChild(hdr);
    const chips = document.createElement('div');
    chips.className = 'recent-chips';
    recentVisible.forEach(id => {
      const b = BikeStore.getById(id);
      if (!b) return;
      const chip = document.createElement('button');
      chip.className = 'recent-chip';
      chip.textContent = `${b.model} '${String(b.year).slice(2)}`;
      chip.title = `${b.brand} ${b.model} ${b.year}`;
      chip.addEventListener('click', () => toggleBike(b, true));
      chips.appendChild(chip);
    });
    container.appendChild(chips);
  }

  const groups = new Map();
  bikes.forEach(b => {
    if (!groups.has(b.brand)) groups.set(b.brand, []);
    groups.get(b.brand).push(b);
  });
  groups.forEach((brandBikes, brand) => {
    const header = document.createElement('div');
    header.className = 'bike-group-header';
    header.textContent = brand;
    container.appendChild(header);
    brandBikes.forEach(bike => container.appendChild(makeBikeItem(bike)));
  });
}

function makeBikeItem(bike) {
  const isSelected = state.selectedBikes.has(bike.id);
  const colorIdx   = state.colorMap.get(bike.id) ?? -1;
  const colors     = ['#58a6ff', '#f78166', '#3fb950', '#d2a8ff'];

  const div = document.createElement('div');
  div.className = 'bike-item' + (isSelected ? ' selected' : '');
  div.dataset.id = bike.id;

  const dot = document.createElement('span');
  dot.className = 'bike-color-dot';
  if (isSelected && colorIdx >= 0) dot.style.background = colors[colorIdx];

  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = isSelected;

  const info = document.createElement('div');
  info.className = 'bike-item-info';
  info.innerHTML = `<div class="bike-item-name">${bike.model}</div>
    <div class="bike-item-year">${bike.year}</div>`;

  div.appendChild(cb); div.appendChild(dot); div.appendChild(info);
  div.addEventListener('click', e => {
    if (e.target !== cb) cb.checked = !cb.checked;
    toggleBike(bike, cb.checked);
  });
  return div;
}

function _addToRecent(id) {
  state.recentBikes = [id, ...state.recentBikes.filter(r => r !== id)].slice(0, MAX_RECENT);
}

function toggleBike(bike, selected) {
  if (selected) {
    if (state.selectedBikes.size >= MAX_SELECTED) {
      const oldestId = state.selectedBikes.keys().next().value;
      _addToRecent(oldestId);
      state.selectedBikes.delete(oldestId);
      state.colorMap.delete(oldestId);
    }
    state.colorMap.set(bike.id, state.nextColorIdx++ % BIKE_COLORS.length);
    state.selectedBikes.set(bike.id, { sizeIdx: 0, autoSize: false, cockpit: defaultCockpit() });
  } else {
    _addToRecent(bike.id);
    state.selectedBikes.delete(bike.id);
    state.colorMap.delete(bike.id);
  }
  renderBikeList(BikeStore.search($('#search-box')?.value ?? ''));
  renderSizeSelectors();
  renderComparison();
  saveState();
}

// ── Size selectors ────────────────────────────────────────────────────────────

function renderSizeSelectors() {
  const container = $('#size-selectors');
  container.innerHTML = '';
  const colors = BIKE_COLORS;

  state.selectedBikes.forEach((bs, bikeId) => {
    const bike = BikeStore.getById(bikeId);
    if (!bike) return;
    const color = colors[state.colorMap.get(bikeId) ?? 0];

    const row = document.createElement('div');
    row.className = 'size-row';
    row.style.borderLeftColor = color;

    const label = document.createElement('label');
    label.textContent = `${bike.brand} ${bike.model}`;
    label.style.color = color;

    const sel = document.createElement('select');
    sel.dataset.bikeId = bikeId;

    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = bs.autoSize
      ? `Auto (${bike.sizes[bs.sizeIdx]?.label ?? '…'})`
      : 'Auto';
    if (bs.autoSize) autoOpt.selected = true;
    sel.appendChild(autoOpt);

    bike.sizes.forEach((s, idx) => {
      const opt = document.createElement('option');
      opt.value = idx; opt.textContent = s.label;
      if (!bs.autoSize && idx === bs.sizeIdx) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', () => {
      if (sel.value === 'auto') {
        bs.autoSize = true;
        const best = bestSizeIdx(bike, state.fit);
        if (best !== null) bs.sizeIdx = best;
      } else {
        bs.autoSize = false;
        bs.sizeIdx  = Number(sel.value);
      }
      renderComparison();
      saveState();
    });

    row.appendChild(label); row.appendChild(sel);
    container.appendChild(row);
  });
}

// ── Fit inputs ────────────────────────────────────────────────────────────────

const FIT_FIELDS = ['saddle-height', 'seat-to-hood', 'hood-to-bb'];
const FIT_KEYS   = ['saddleHeight',  'seatToHood',   'hoodToBB'];

function bindFitInputs() {
  FIT_FIELDS.forEach((id, i) => {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener('input', () => {
      const raw = parseFloat(el.value);
      state.fit[FIT_KEYS[i]] = isNaN(raw) ? null : UNIT_CFG[state.unit].toMM(raw);
      renderComparison(); saveState();
    });
  });
}

// ── Unit toggle ───────────────────────────────────────────────────────────────

function bindUnitToggle() {
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newUnit = btn.dataset.unit;
      if (newUnit === state.unit) return;
      switchUnit(newUnit);
    });
  });
}

function switchUnit(newUnit) {
  const oldCfg = UNIT_CFG[state.unit];
  const newCfg = UNIT_CFG[newUnit];
  state.unit = newUnit;

  FIT_FIELDS.forEach((id, i) => {
    const el = $(`#${id}`);
    if (!el || !el.value) return;
    const mm = oldCfg.toMM(parseFloat(el.value));
    el.value = newCfg.fromMM(mm);
  });

  updateFitInputAttrs();

  document.querySelectorAll('.unit-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.unit === newUnit);
  });
  document.querySelectorAll('.fit-unit-label').forEach(el => {
    el.textContent = newCfg.suffix;
  });

  saveState();
}

function updateFitInputAttrs() {
  const cfg = UNIT_CFG[state.unit];
  FIT_FIELDS.forEach((id, i) => {
    const el = $(`#${id}`);
    if (!el) return;
    const range = cfg.fitRanges[FIT_KEYS[i]];
    el.step = cfg.step;
    el.min  = range.min;
    el.max  = range.max;
  });
}

// ── Best-size picker ──────────────────────────────────────────────────────────

function bestSizeIdx(bike, fit) {
  if (!fit?.saddleHeight || !fit?.seatToHood || !fit?.hoodToBB) return null;

  let bestIdx   = null;
  let bestScore = Infinity;

  bike.sizes.forEach((size, idx) => {
    const htTop  = { x: size.reach, y: size.stack };
    const result = FitCalculator.findStem(size, htTop,
      fit.saddleHeight, fit.seatToHood, fit.hoodToBB, 0, 0, 80);
    if (!result) return;

    const { stemLength, stemAngleDeg } = result;
    if (stemLength < 40 || stemLength > 140) return;
    if (Math.abs(stemAngleDeg) > 17) return;

    // Prefer stem near 90 mm and angle near 0°
    const score = Math.abs(stemLength - 90) + Math.abs(stemAngleDeg) * 3;
    if (score < bestScore) { bestScore = score; bestIdx = idx; }
  });

  return bestIdx;
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderComparison() {
  const bikeList = [];
  const hasFit = !!(state.fit.saddleHeight && state.fit.seatToHood && state.fit.hoodToBB);

  // Apply auto-sizing and refresh the "Auto (X)" label in the select
  if (hasFit) {
    state.selectedBikes.forEach((bs, bikeId) => {
      if (!bs.autoSize) return;
      const bike = BikeStore.getById(bikeId);
      if (!bike) return;
      const idx = bestSizeIdx(bike, state.fit);
      if (idx === null) return;
      bs.sizeIdx = idx;
      const sel = document.querySelector(`select[data-bike-id="${bikeId}"]`);
      const autoOpt = sel?.querySelector('option[value="auto"]');
      if (autoOpt) autoOpt.textContent = `Auto (${bike.sizes[idx].label})`;
    });
  }

  state.selectedBikes.forEach((bs, bikeId) => {
    const geo = BikeStore.getById(bikeId);
    if (!geo) return;
    const size    = geo.sizes[bs.sizeIdx];
    const cockpit = bs.cockpit;
    const effectiveReach = (cockpit.barReach || 80) + (cockpit.hoodLength || 0);

    let recommendedHood = null;
    if (hasFit) {
      const htTop  = { x: size.reach, y: size.stack };
      const result = FitCalculator.findStem(
        size, htTop,
        state.fit.saddleHeight, state.fit.seatToHood, state.fit.hoodToBB,
        0, cockpit.setback || 0, effectiveReach
      );
      recommendedHood = result ? result.hoodPos : null;
    }

    bikeList.push({
      id:              bikeId,
      geo,
      size,
      sizeIdx:         bs.sizeIdx,
      stemLength:      cockpit.stemLength,
      stemAngle:       cockpit.stemAngle,
      spacers:         cockpit.spacers,
      setback:         cockpit.setback || 0,
      barReach:        effectiveReach,
      recommendedHood,
    });
  });

  window._renderer.setBikes(bikeList);
  window._renderer.setFit(state.fit.saddleHeight ? state.fit : null);

  renderTable(bikeList);
  renderFitPanel(bikeList);
  renderCockpitPanel(bikeList);

  const ph = $('#canvas-placeholder');
  if (ph) ph.style.display = bikeList.length ? 'none' : 'flex';
}

// ── Comparison table ──────────────────────────────────────────────────────────

const GEO_COLS = [
  { key: 'stack',        label: 'Stack',        unit: 'mm', fmt: v => Math.round(v) },
  { key: 'reach',        label: 'Reach',        unit: 'mm', fmt: v => Math.round(v) },
  { key: 'ht_length',    label: 'HT Length',    unit: 'mm', fmt: v => Math.round(v) },
  { key: 'ht_angle',     label: 'HTA',          unit: '°',  fmt: v => v.toFixed(1) },
  { key: 'st_angle',     label: 'STA',          unit: '°',  fmt: v => v.toFixed(1) },
  { key: 'tt_length',    label: 'ETT',          unit: 'mm', fmt: v => Math.round(v) },
  { key: 'cs_length',    label: 'Chainstay',    unit: 'mm', fmt: v => Math.round(v) },
  { key: 'bb_drop',      label: 'BB Drop',      unit: 'mm', fmt: v => Math.round(v) },
  { key: 'wheelbase',    label: 'Wheelbase',    unit: 'mm', fmt: v => Math.round(v) },
  { key: 'front_center', label: 'Front Center', unit: 'mm', fmt: v => Math.round(v) },
  { key: 'fork_offset',  label: 'Fork Offset',  unit: 'mm', fmt: v => Math.round(v) },
];

function _tableCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function _tableLabelCell(label, unit, note) {
  const td = document.createElement('td');
  td.innerHTML = label
    + (unit ? ` <span style="color:var(--text-muted);font-size:10px">${unit}</span>` : '')
    + (note ? ` <span style="color:var(--text-muted);font-size:10px;font-style:italic">${note}</span>` : '');
  return td;
}

function _addDerivedRow(tbody, label, unit, bikes, fn, note) {
  const row = document.createElement('tr');
  row.appendChild(_tableLabelCell(label, unit, note));
  bikes.forEach(b => row.appendChild(_tableCell(fn(b) ?? '—')));
  tbody.appendChild(row);
}

function renderTable(bikes) {
  const tbody = $('#geo-tbody'), thead = $('#geo-thead');
  if (!tbody || !thead) return;

  if (!bikes.length) {
    tbody.innerHTML = `<tr><td colspan="99" class="table-empty">Select bikes to compare</td></tr>`;
    thead.innerHTML = '';
    return;
  }

  const colors = BIKE_COLORS;
  thead.innerHTML = '';
  const hr = document.createElement('tr');
  const th0 = document.createElement('th'); th0.textContent = 'Measurement'; hr.appendChild(th0);
  bikes.forEach(b => {
    const th = document.createElement('th');
    const ci = state.colorMap.get(b.id) ?? 0;
    th.innerHTML = `<span class="bike-label"><span class="color-dot" style="background:${colors[ci]}"></span>${b.geo.brand} ${b.geo.model} ${b.size.label}</span>`;
    hr.appendChild(th);
  });
  thead.appendChild(hr);

  tbody.innerHTML = '';
  GEO_COLS.forEach(col => {
    const row = document.createElement('tr');
    row.appendChild(_tableLabelCell(col.label, col.unit));
    bikes.forEach(b => {
      row.appendChild(_tableCell(b.size[col.key] != null ? col.fmt(b.size[col.key]) : '—'));
    });
    tbody.appendChild(row);
  });

  const sep = document.createElement('tr');
  sep.innerHTML = `<td colspan="${bikes.length + 1}" style="padding:0;height:2px;background:var(--surface2)"></td>`;
  tbody.appendChild(sep);

  _addDerivedRow(tbody, 'Stack/Reach', '', bikes, b =>
    (b.size.stack && b.size.reach) ? (b.size.stack / b.size.reach).toFixed(3) : null
  );
  _addDerivedRow(tbody, 'BB Height', 'mm', bikes, b =>
    b.size.bb_drop != null ? Math.round(330 - b.size.bb_drop) : null,
    '(est. 700c/40mm)'
  );
  _addDerivedRow(tbody, 'Trail', 'mm', bikes, b => {
    if (b.size.ht_angle == null || b.size.fork_offset == null) return null;
    const hta = b.size.ht_angle * Math.PI / 180;
    return Math.round((330 * Math.cos(hta) - b.size.fork_offset) / Math.sin(hta));
  });
}

// ── Cockpit panel ─────────────────────────────────────────────────────────────

function renderCockpitPanel(bikes) {
  const panel = $('#cockpit-inputs');
  if (!panel) return;

  // Don't rebuild while a cockpit input has keyboard focus — would disrupt typing
  if (document.activeElement?.id?.startsWith('c-')) return;

  if (!bikes.length) {
    panel.innerHTML = '<div class="table-empty">Select bikes to configure components</div>';
    return;
  }

  const colors = BIKE_COLORS;
  panel.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'geo-table';

  const thead = document.createElement('thead');
  const hr    = document.createElement('tr');
  const th0   = document.createElement('th');
  th0.textContent = 'Component';
  hr.appendChild(th0);
  bikes.forEach(b => {
    const th = document.createElement('th');
    const ci = state.colorMap.get(b.id) ?? 0;
    th.innerHTML = `<span class="bike-label"><span class="color-dot" style="background:${colors[ci]}"></span>${b.geo.brand} ${b.geo.model} ${b.size.label}</span>`;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  COCKPIT_FIELDS.forEach(field => {
    const row = document.createElement('tr');

    const td0 = document.createElement('td');
    td0.innerHTML = field.label
      + (field.unit ? ` <span style="color:var(--text-muted);font-size:10px">${field.unit}</span>` : '');
    row.appendChild(td0);

    bikes.forEach(b => {
      const cockpit = state.selectedBikes.get(b.id).cockpit;
      const td  = document.createElement('td');
      const inp = document.createElement('input');
      inp.type  = 'number';
      inp.id    = `c-${b.id}-${field.key}`;
      inp.className = 'cockpit-input';
      inp.min   = field.min;
      inp.max   = field.max;
      inp.step  = field.step;

      const val = cockpit[field.key];
      if (val != null)         inp.value       = val;
      else if (!field.nullable) inp.value       = field.def ?? '';
      else                      inp.placeholder = '—';

      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        cockpit[field.key] = isNaN(v) ? (field.nullable ? null : (field.def ?? null)) : v;
        renderComparison();
        saveState();
      });

      td.appendChild(inp);
      row.appendChild(td);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  panel.appendChild(table);
}

function syncCockpitInputs() {
  state.selectedBikes.forEach((bs, bikeId) => {
    COCKPIT_FIELDS.forEach(field => {
      const el = document.getElementById(`c-${bikeId}-${field.key}`);
      if (!el) return;
      const val = bs.cockpit[field.key];
      el.value = val != null ? val : (field.def != null ? String(field.def) : '');
    });
  });
}

// ── Fit panel ─────────────────────────────────────────────────────────────────

const STEM_LENGTHS  = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140];
const STEM_ANGLES   = [-17, -10, -6, 0, 6, 10, 17];
const SPACER_STACKS = [0, 5, 10, 15, 20, 25, 30];
const SETBACKS      = [-25, -15, -5, 0, 5, 15, 25];
const SH_OFFSETS    = [-10, -5, 0, 5, 10];

function _fitCombos(b, fit) {
  const htTop    = { x: b.size.reach, y: b.size.stack };
  const barReach = fit.barReach || 80;
  const out      = [];

  for (const shOff of SH_OFFSETS) {
    const sh = fit.saddleHeight + shOff;
    if (sh <= 0) continue;
    for (const setback of SETBACKS) {
      const saddle = FitCalculator.saddlePosition(b.size, sh, setback);
      for (const sp of SPACER_STACKS) {
        for (const len of STEM_LENGTHS) {
          for (const ang of STEM_ANGLES) {
            const hood   = FitCalculator.hoodPosition(b.size, htTop, len, ang, sp, barReach);
            const actual = FitCalculator.triangleDistances(saddle, hood);
            const dSth   = actual.seatToHood - fit.seatToHood;
            const dHtb   = actual.hoodToBB   - fit.hoodToBB;
            // Least sum of squares; spacers 0–10mm are equal, penalise above 10mm
            const spacerPenalty = Math.max(0, sp - 10) * 0.5;
            const score  = dSth * dSth + dHtb * dHtb + spacerPenalty;
            out.push({ sh, shOff, setback, sp, len, ang, dSth, dHtb, score });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 12);
}

function _dColor(mm) {
  const a = Math.abs(mm);
  return a <= 3 ? 'var(--success)' : a <= 8 ? '#e3b341' : 'var(--accent2)';
}

function _dStr(mm) {
  return (mm >= 0 ? '+' : '') + Math.round(mm);
}

function renderFitPanel(bikes) {
  const panel = $('#fit-results');
  if (!panel) return;

  const hasFit = state.fit.saddleHeight && state.fit.seatToHood && state.fit.hoodToBB;
  if (!hasFit || !bikes.length) { panel.innerHTML = ''; return; }

  const colors = BIKE_COLORS;
  panel.innerHTML = '';

  bikes.forEach(b => {
    const cockpit = state.selectedBikes.get(b.id).cockpit;
    const effectiveReach = (cockpit.barReach || 80) + (cockpit.hoodLength || 0);
    const fit    = { ...state.fit, barReach: effectiveReach };
    const color  = colors[state.colorMap.get(b.id) ?? 0];
    const name   = `${b.geo.brand} ${b.geo.model} ${b.size.label}`;
    const combos = _fitCombos(b, fit);

    const card = document.createElement('div');
    card.style.cssText = `border-left:3px solid ${color};padding:8px 10px;margin-bottom:8px;background:var(--surface);border-radius:4px;`;

    const titleEl = document.createElement('div');
    titleEl.style.cssText = `font-weight:600;margin-bottom:6px;color:${color};font-size:12px`;
    titleEl.textContent = name;
    card.appendChild(titleEl);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'overflow-x:auto';

    const table = document.createElement('table');
    table.className = 'stem-table';
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px';

    const thS = 'padding:2px 5px;text-align:right;font-weight:500;color:var(--text-muted);white-space:nowrap';
    table.innerHTML = `<thead><tr>
      <th style="${thS}">Saddle</th>
      <th style="${thS}">Setback</th>
      <th style="${thS}">Stem</th>
      <th style="${thS}">Angle</th>
      <th style="${thS}" class="fit-adj-spacers">Spacers</th>
      <th style="${thS}">Δ</th>
    </tr></thead>`;

    const tdS = 'padding:2px 5px;text-align:right;white-space:nowrap;';
    const tbody = document.createElement('tbody');
    const SHOW_DEFAULT = 3;
    let expanded = false;

    const renderRows = () => {
      tbody.innerHTML = '';
      const visible = expanded ? combos : combos.slice(0, SHOW_DEFAULT);

      visible.forEach(c => {
        const isActive = cockpit.stemLength === c.len   &&
                         cockpit.stemAngle  === c.ang   &&
                         cockpit.spacers    === c.sp    &&
                         (cockpit.setback || 0) === c.setback;
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        if (isActive) tr.style.background = 'rgba(88,166,255,0.10)';

        const angStr     = `${c.ang >= 0 ? '+' : ''}${c.ang}°`;
        const setbackStr = `${c.setback >= 0 ? '+' : ''}${c.setback}`;
        const shColor    = c.shOff === 0 ? 'var(--text)' : Math.abs(c.shOff) <= 5 ? '#e3b341' : 'var(--accent2)';
        const totalDelta = Math.sqrt(c.dSth * c.dSth + c.dHtb * c.dHtb);
        const deltaColor = _dColor(totalDelta);
        const deltaStr   = totalDelta < 0.5 ? '✓' : `±${totalDelta.toFixed(1)}`;

        tr.innerHTML = `
          <td style="${tdS}color:${shColor}">${Math.round(c.sh)}</td>
          <td style="${tdS}color:var(--text)">${setbackStr}</td>
          <td style="${tdS}color:var(--text)">${c.len}mm</td>
          <td style="${tdS}color:var(--text)">${angStr}</td>
          <td class="fit-adj-spacers" style="${tdS}color:var(--text-muted)">${c.sp}mm</td>
          <td style="${tdS}color:${deltaColor}">${deltaStr}</td>`;

        tr.addEventListener('click', () => {
          cockpit.stemLength = c.len;
          cockpit.stemAngle  = c.ang;
          cockpit.spacers    = c.sp;
          cockpit.setback    = c.setback;
          syncCockpitInputs();
          renderComparison();
          saveState();
        });
        tr.addEventListener('mouseenter', () => { if (!isActive) tr.style.background = 'var(--surface2)'; });
        tr.addEventListener('mouseleave', () => { tr.style.background = isActive ? 'rgba(88,166,255,0.10)' : ''; });

        tbody.appendChild(tr);
      });
    };

    renderRows();
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);

    // Show more / show less toggle
    if (combos.length > SHOW_DEFAULT) {
      const toggle = document.createElement('button');
      toggle.className = 'fit-expand-btn';
      toggle.textContent = `Show ${combos.length - SHOW_DEFAULT} more`;
      toggle.addEventListener('click', () => {
        expanded = !expanded;
        toggle.textContent = expanded ? 'Show less' : `Show ${combos.length - SHOW_DEFAULT} more`;
        renderRows();
      });
      card.appendChild(toggle);
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:4px;font-size:10px;color:var(--text-muted)';
    foot.textContent = 'Saddle & setback in mm from BB · yellow/red saddle = height adjustment · click row to apply';
    card.appendChild(foot);

    panel.appendChild(card);
  });

}

// ── Resize handles ────────────────────────────────────────────────────────────

function _makeResizable(handle, isVertical, inverted, getSize, setSize, min, max) {
  if (!handle) return;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    handle.classList.add('dragging');
    document.body.style.cursor    = isVertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const startPos  = isVertical ? e.clientY : e.clientX;
    const startSize = getSize();

    const onMove = e => {
      const delta = (isVertical ? e.clientY : e.clientX) - startPos;
      setSize(Math.max(min, Math.min(max, startSize + (inverted ? -delta : delta))));
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

function bindResizeHandles() {
  const sidebar    = document.querySelector('.sidebar');
  const fitArea    = document.querySelector('.fit-area');
  const geoSidebar = document.querySelector('.geo-sidebar');

  // Left vertical divider: drag right → sidebar wider
  _makeResizable(document.getElementById('rh-sidebar'), false, false,
    () => sidebar.getBoundingClientRect().width,
    w  => { sidebar.style.width = w + 'px'; },
    150, 500
  );

  // Horizontal divider: drag up → fit area taller
  _makeResizable(document.getElementById('rh-fit'), true, true,
    () => fitArea.getBoundingClientRect().height,
    h  => { fitArea.style.height = h + 'px'; },
    80, 600
  );

  // Right vertical divider: drag left → geo sidebar wider
  _makeResizable(document.getElementById('rh-geo'), false, true,
    () => geoSidebar.getBoundingClientRect().width,
    w  => { geoSidebar.style.width = w + 'px'; },
    150, 500
  );
}

// ── Mobile nav ────────────────────────────────────────────────────────────────

function bindMobileNav() {
  document.querySelectorAll('.mobile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelector('.app-wrap').dataset.panel = tab.dataset.panel;
      document.querySelectorAll('.mobile-tab').forEach(t => t.classList.toggle('active', t === tab));
    });
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

function bindSearch() {
  const box = $('#search-box');
  if (box) box.addEventListener('input', () => renderBikeList(BikeStore.search(box.value)));
}

// ── Persistence ───────────────────────────────────────────────────────────────

function saveState() {
  const s = {
    bikes:        [...state.selectedBikes.entries()].map(([id, bs]) => ({
      id, sizeIdx: bs.sizeIdx, autoSize: bs.autoSize ?? false, cockpit: bs.cockpit,
    })),
    colors:       [...state.colorMap.entries()],
    nextColorIdx: state.nextColorIdx,
    fit:          state.fit,
    unit:         state.unit,
    recentBikes:  state.recentBikes,
  };
  try { localStorage.setItem('mmbf-state', JSON.stringify(s)); } catch (_) {}

  const p = new URLSearchParams();
  if (state.fit.saddleHeight) p.set('sh',  state.fit.saddleHeight);
  if (state.fit.seatToHood)   p.set('sth', state.fit.seatToHood);
  if (state.fit.hoodToBB)     p.set('htb', state.fit.hoodToBB);
  p.set('unit', state.unit);
  if (state.selectedBikes.size) {
    const ids = [...state.selectedBikes.keys()];
    p.set('bikes', ids.join(','));
    p.set('sizes', ids.map(id => {
      const bs = state.selectedBikes.get(id);
      return bs.autoSize ? 'a' : bs.sizeIdx;
    }).join(','));
  }
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

function restoreState() {
  const params = new URLSearchParams(location.search);
  if (params.has('sh') || params.has('bikes')) {
    restoreFromURL(params);
  } else {
    restoreFromLocalStorage();
  }
  updateFitInputAttrs();
  document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === state.unit));
  document.querySelectorAll('.fit-unit-label').forEach(el => el.textContent = UNIT_CFG[state.unit].suffix);
}

function restoreFromURL(params) {
  state.unit = params.get('unit') === 'in' ? 'in' : 'cm';
  const cfg  = UNIT_CFG[state.unit];

  ['sh', 'sth', 'htb'].forEach((key, i) => {
    if (!params.has(key)) return;
    const mm = parseFloat(params.get(key));
    state.fit[FIT_KEYS[i]] = mm;
    setInput(`#${FIT_FIELDS[i]}`, cfg.fromMM(mm));
  });

  if (params.has('bikes')) {
    const ids  = params.get('bikes').split(',');
    const szs  = params.has('sizes') ? params.get('sizes').split(',') : [];
    ids.forEach((id, i) => {
      if (!BikeStore.getById(id)) return;
      state.colorMap.set(id, state.nextColorIdx++ % BIKE_COLORS.length);
      const sz       = szs[i] ?? '0';
      const autoSize = sz === 'a';
      state.selectedBikes.set(id, {
        sizeIdx:  autoSize ? 0 : (Number(sz) || 0),
        autoSize,
        cockpit:  defaultCockpit(),
      });
    });
  }

  // Backward compat: old-format URL had global cockpit params
  const legacyCockpit = {};
  if (params.has('sl')) legacyCockpit.stemLength = +params.get('sl');
  if (params.has('sa')) legacyCockpit.stemAngle  = +params.get('sa');
  if (params.has('sp')) legacyCockpit.spacers    = +params.get('sp');
  if (params.has('sb')) legacyCockpit.setback    = +params.get('sb');
  if (params.has('br')) legacyCockpit.barReach   = +params.get('br');
  if (params.has('hl')) legacyCockpit.hoodLength = +params.get('hl');
  if (Object.keys(legacyCockpit).length) {
    state.selectedBikes.forEach(bs => Object.assign(bs.cockpit, legacyCockpit));
  }

  renderBikeList(BikeStore.getAll());
  renderSizeSelectors();
  renderComparison();
}

function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem('mmbf-state');
    if (!raw) return;
    const s = JSON.parse(raw);

    state.unit = s.unit === 'in' ? 'in' : 'cm';
    const cfg  = UNIT_CFG[state.unit];

    if (s.fit) {
      state.fit = s.fit;
      FIT_FIELDS.forEach((id, i) => {
        if (state.fit[FIT_KEYS[i]]) setInput(`#${id}`, cfg.fromMM(state.fit[FIT_KEYS[i]]));
      });
    }

    if (s.nextColorIdx) state.nextColorIdx = s.nextColorIdx;
    if (s.colors) s.colors.forEach(([id, ci]) => state.colorMap.set(id, ci));
    if (Array.isArray(s.recentBikes)) state.recentBikes = s.recentBikes;

    if (s.bikes) s.bikes.forEach(({ id, sizeIdx, autoSize, cockpit }) => {
      if (!BikeStore.getById(id)) return;
      state.selectedBikes.set(id, {
        sizeIdx:  sizeIdx ?? 0,
        autoSize: autoSize ?? false,
        cockpit:  { ...defaultCockpit(), ...(cockpit || {}) },
      });
    });

    // Backward compat: old format stored global cockpit at top level
    if (s.cockpit && !s.bikes?.[0]?.cockpit) {
      state.selectedBikes.forEach(bs => Object.assign(bs.cockpit, s.cockpit));
    }

    renderBikeList(BikeStore.getAll());
    renderSizeSelectors();
    renderComparison();
  } catch (_) {}
}

function setInput(sel, val) {
  const el = $(sel);
  if (el && val != null) el.value = val;
}

function showError(msg) {
  const el = $('#error-msg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

document.addEventListener('DOMContentLoaded', init);
