'use strict';

const BikeStore = {
  _data: null,

  async load(baseUrl = '') {
    if (this._data) return this._data;
    const res = await fetch(`${baseUrl}/bikes.json`);
    if (!res.ok) throw new Error(`Failed to load bikes.json: ${res.status}`);
    const raw = await res.json();
    // raw is { "slug": { brand, model, ... }, ... }
    this._data = Object.entries(raw).map(([slug, bike]) => ({ ...bike, id: slug }));
    return this._data;
  },

  getAll() { return this._data || []; },

  getById(id) { return (this._data || []).find(b => b.id === id) || null; },

  search(query) {
    if (!query) return this.getAll();
    const q = query.toLowerCase();
    return this.getAll().filter(b =>
      `${b.brand} ${b.model} ${b.year}`.toLowerCase().includes(q)
    );
  },

  grouped() {
    const map = new Map();
    for (const bike of this.getAll()) {
      if (!map.has(bike.brand)) map.set(bike.brand, []);
      map.get(bike.brand).push(bike);
    }
    return map;
  },
};
