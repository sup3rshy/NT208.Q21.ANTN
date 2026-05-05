/**
 * SocialShield Heatmap — Canvas-based, no external libs.
 *
 * Pipeline:
 *  1. Geocode location names qua OSM Nominatim (cache vào chrome.storage.local)
 *  2. Project lat/lng -> Mercator -> canvas pixels (auto-fit bounding box + padding)
 *  3. Render heatmap blob per point dùng radial gradient, alpha tăng theo count
 *  4. Overlay labels cho top-3 locations
 *
 * Tại sao không dùng Leaflet: bundle ~150KB binary, không sinh được từ code,
 * và cần network để load OSM tile. Canvas approach: 0 dep, full client-side
 * sau khi geocode (cache permanent).
 */

const SocialShieldHeatmap = {

  GEOCODE_CACHE_KEY: 'ss_geocode_cache_v1',
  NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',

  /** Geocode 1 string → {lat, lng} hoặc null. Cache forever. */
  async geocode(name) {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    const cache = await this._loadCache();
    if (cache[key] !== undefined) return cache[key]; // null hoặc {lat,lng}

    try {
      const url = `${this.NOMINATIM_URL}?format=json&q=${encodeURIComponent(name)}&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SocialShield-Extension/1.0 (privacy education tool)' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data[0]) {
        const out = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        cache[key] = out;
        await this._saveCache(cache);
        return out;
      }
      cache[key] = null; // negative cache để tránh hỏi lại
      await this._saveCache(cache);
      return null;
    } catch (err) {
      return null;
    }
  },

  async _loadCache() {
    if (typeof chrome === 'undefined' || !chrome.storage) return {};
    try {
      const r = await chrome.storage.local.get(this.GEOCODE_CACHE_KEY);
      return r[this.GEOCODE_CACHE_KEY] || {};
    } catch { return {}; }
  },

  async _saveCache(cache) {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    try { await chrome.storage.local.set({ [this.GEOCODE_CACHE_KEY]: cache }); } catch {}
  },

  /** Geocode batch với rate-limit ~1 req/sec (Nominatim TOS). */
  async geocodeBatch(names, onProgress) {
    const out = [];
    const cache = await this._loadCache();
    const uncached = names.filter(n => !(n.trim().toLowerCase() in cache));
    let done = 0;
    for (const name of names) {
      const cached = cache[name.trim().toLowerCase()];
      let coord;
      if (cached !== undefined) {
        coord = cached;
      } else {
        coord = await this.geocode(name);
        if (uncached.includes(name)) await this._sleep(1100); // tôn trọng rate limit
      }
      out.push({ name, coord });
      done++;
      if (onProgress) onProgress(done, names.length);
    }
    return out;
  },

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  // ==================== Mercator projection ====================

  _project(lat, lng) {
    const x = (lng + 180) / 360;
    const sin = Math.sin((lat * Math.PI) / 180);
    const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    return { x, y };
  },

  /**
   * Render heatmap lên canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {Array<{lat,lng,count,name}>} points
   * @param {Object} options
   */
  render(canvas, points, options = {}) {
    const { padding = 30, minRadius = 24, maxRadius = 80, label = true } = options;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const valid = points.filter(p => isFinite(p.lat) && isFinite(p.lng));
    if (valid.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No geocodable locations', W / 2, H / 2);
      return;
    }

    // Background: gradient blue
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0f1730');
    bg.addColorStop(1, '#1a2540');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Compute bounds with min span để 1-2 điểm gần nhau không zoom quá close
    const projected = valid.map(p => ({ ...p, ...this._project(p.lat, p.lng) }));
    let minX = Math.min(...projected.map(p => p.x));
    let maxX = Math.max(...projected.map(p => p.x));
    let minY = Math.min(...projected.map(p => p.y));
    let maxY = Math.max(...projected.map(p => p.y));
    const spanX = maxX - minX, spanY = maxY - minY;
    const minSpan = 0.005;
    if (spanX < minSpan) { const cx = (minX + maxX) / 2; minX = cx - minSpan / 2; maxX = cx + minSpan / 2; }
    if (spanY < minSpan) { const cy = (minY + maxY) / 2; minY = cy - minSpan / 2; maxY = cy + minSpan / 2; }

    const innerW = W - padding * 2;
    const innerH = H - padding * 2;
    const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
    const offsetX = padding + (innerW - (maxX - minX) * scale) / 2;
    const offsetY = padding + (innerH - (maxY - minY) * scale) / 2;

    const px = (p) => offsetX + (p.x - minX) * scale;
    const py = (p) => offsetY + (p.y - minY) * scale;

    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / 5); ctx.lineTo(W, (H * i) / 5);
      ctx.moveTo((W * i) / 5, 0); ctx.lineTo((W * i) / 5, H);
      ctx.stroke();
    }

    const maxCount = Math.max(...projected.map(p => p.count || 1));

    // Render heat blobs với additive blending
    ctx.globalCompositeOperation = 'lighter';
    for (const p of projected) {
      const cx = px(p), cy = py(p);
      const intensity = (p.count || 1) / maxCount;
      const radius = minRadius + (maxRadius - minRadius) * intensity;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      // Color ramp: yellow→orange→red theo intensity
      const hue = 60 - intensity * 60; // 60=yellow, 0=red
      grad.addColorStop(0, `hsla(${hue}, 100%, 55%, 0.85)`);
      grad.addColorStop(0.5, `hsla(${hue}, 100%, 50%, 0.4)`);
      grad.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Center marker dots
    for (const p of projected) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px(p), py(p), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Labels for top-3
    if (label) {
      const sorted = [...projected].sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 3);
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      for (const p of sorted) {
        const cx = px(p), cy = py(p);
        const text = `${p.name} (${p.count}×)`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(cx + 8, cy - 18, tw + 8, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, cx + 12, cy - 5);
      }
    }
  },
};

if (typeof window !== 'undefined') window.SocialShieldHeatmap = SocialShieldHeatmap;
