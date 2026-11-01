// Artwork shared by the flip-board and e-ink screens: weather icons (SVG) and the
// painters for `graphic` cells (world map, radar, ISS track, raw panel pixels).
//
// Painters draw into a 2D canvas context of size w × h with a theme:
//   theme.kind     'flip' | 'eink'
//   theme.color    [r,g,b] → CSS colour suited to the screen (e-ink mutes LED colours)
//   theme.frame    latest 64×32 RGB panel frame (Uint8Array), for 'pixels'

window.FC = window.FC || {};

(function (FC) {
  // ---- weather icons ------------------------------------------------------------
  // Tomorrow.io codes, as used by the Pi's icons/ folder. Five-digit codes carry a
  // trailing day (0) / night (1) digit.
  function condition(code) {
    let c = Number(code) || 0, night = false;
    if (c >= 10000) { night = c % 10 === 1; c = Math.floor(c / 10); }
    let kind = 'cloudy';
    if (c === 1000) kind = 'clear';
    else if (c === 1100) kind = 'mostly_clear';
    else if (c === 1101) kind = 'partly';
    else if (c === 1102 || c === 1001) kind = 'cloudy';
    else if (c >= 2000 && c < 3000) kind = 'fog';
    else if (c >= 4000 && c < 5000) kind = c === 4201 ? 'heavy_rain' : 'rain';
    else if (c >= 5000 && c < 6000) kind = 'snow';
    else if (c >= 6000 && c < 8000) kind = 'sleet';
    else if (c >= 8000) kind = 'storm';
    return { kind, night };
  }
  FC.weatherCondition = condition;

  const PAL = {
    flip: { sun: '#ffc531', ray: '#ffb000', moon: '#e9e3c9', cloud: '#eceff2', cloudEdge: '#b9c0c8',
            dark: '#9aa3ad', rain: '#5aa9ff', snow: '#ffffff', bolt: '#ffd23a', fog: '#c9cdd2' },
    eink: { sun: '#d39a2a', ray: '#c27f12', moon: '#8d8f86', cloud: '#f4f2ea', cloudEdge: '#4b4f55',
            dark: '#6d737b', rain: '#2f6db0', snow: '#4d7fae', bolt: '#c78a00', fog: '#7c8187' },
  };

  const cloud = (p, x, y, s, fill) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M10 30a9 9 0 0 1 1-18 13 13 0 0 1 25-3 10 10 0 0 1 12 9 7 7 0 0 1-1 12z"
      fill="${fill || p.cloud}" stroke="${p.cloudEdge}" stroke-width="${2.2 / s}" stroke-linejoin="round"/>`;
  const sun = (p, x, y, r) => {
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      rays += `<line x1="${x + c * r * 1.35}" y1="${y + s * r * 1.35}" x2="${x + c * r * 1.8}" y2="${y + s * r * 1.8}"/>`;
    }
    return `<g stroke="${p.ray}" stroke-width="3" stroke-linecap="round">${rays}</g><circle cx="${x}" cy="${y}" r="${r}" fill="${p.sun}"/>`;
  };
  const moon = (p, x, y, r) =>
    `<path d="M${x + r * 0.3} ${y - r}a${r} ${r} 0 1 0 ${r * 0.7} ${r * 1.55}a${r * 0.8} ${r * 0.8} 0 0 1-${r * 0.7}-${r * 1.55}z" fill="${p.moon}"/>`;
  const drops = (p, n, heavy) => {
    let s = '';
    for (let i = 0; i < n; i++) s += `<line x1="${20 + i * 9}" y1="38" x2="${16 + i * 9}" y2="${heavy ? 47 : 44}"/>`;
    return `<g stroke="${p.rain}" stroke-width="3" stroke-linecap="round">${s}</g>`;
  };
  const flakes = (p) => [20, 31, 42].map((x, i) =>
    `<g transform="translate(${x} ${41 + (i % 2) * 3})" stroke="${p.snow}" stroke-width="2" stroke-linecap="round">
      <line x1="-3.5" y1="0" x2="3.5" y2="0"/><line x1="-1.8" y1="-3" x2="1.8" y2="3"/><line x1="-1.8" y1="3" x2="1.8" y2="-3"/></g>`).join('');

  FC.weatherSVG = (code, night, kind = 'flip') => {
    const p = PAL[kind] || PAL.flip;
    const c = condition(code);
    night = night || c.night;
    const orb = (x, y, r) => (night ? moon(p, x, y, r) : sun(p, x, y, r));
    let body;
    switch (c.kind) {
      case 'clear': body = night ? moon(p, 32, 24, 14) : sun(p, 32, 24, 11); break;
      case 'mostly_clear': body = orb(26, 20, 9) + cloud(p, 26, 22, 0.62); break;
      case 'partly': body = orb(22, 17, 9) + cloud(p, 16, 14, 0.85); break;
      case 'cloudy': body = cloud(p, 2, 8, 1.15, p.cloud); break;
      case 'fog': body = cloud(p, 6, 2, 0.95) +
        `<g stroke="${p.fog}" stroke-width="3" stroke-linecap="round"><line x1="12" y1="38" x2="52" y2="38"/><line x1="18" y1="45" x2="46" y2="45"/></g>`; break;
      case 'rain': body = cloud(p, 6, 0, 1, p.cloud) + drops(p, 3); break;
      case 'heavy_rain': body = cloud(p, 6, 0, 1, p.dark) + drops(p, 4, true); break;
      case 'snow': body = cloud(p, 6, 0, 1) + flakes(p); break;
      case 'sleet': body = cloud(p, 6, 0, 1) + drops(p, 2) + flakes(p).split('</g>')[0] + '</g>'; break;
      case 'storm': body = cloud(p, 6, 0, 1, p.dark) +
        `<path d="M33 30l-7 10h6l-4 9 11-13h-6l4-6z" fill="${p.bolt}"/>`; break;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 50">${body}</svg>`;
  };

  FC.glyphSVG = (name, kind = 'flip') => {
    const ink = kind === 'eink' ? '#3c3c3a' : '#e9e3c9';
    if (name === 'note') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="${ink}"
      d="M18 8l22-4v26a6 6 0 1 1-3-5.2V12l-16 3v19a6 6 0 1 1-3-5.2z"/></svg>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`;
  };

  // SVG markup → data URL (an <img> source or something to drawImage)
  FC.svgURL = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  // ---- painters for graphic cells ---------------------------------------------------
  const deg = Math.PI / 180;
  function angularDist(lat1, lon1, lat2, lon2) {
    const a = Math.sin(lat1 * deg) * Math.sin(lat2 * deg) + Math.cos(lat1 * deg) * Math.cos(lat2 * deg) * Math.cos((lon1 - lon2) * deg);
    return Math.acos(Math.max(-1, Math.min(1, a))) / deg;
  }

  let landPath = null;
  const WORLD = {
    flip: { water: '#123a5c', land: '#3f8a4f', nightWater: '#050b16', nightLand: '#0d2015', line: null },
    eink: { water: '#b9cdd6', land: '#c9c19a', nightWater: '#55606b', nightLand: '#6a6656', line: '#6d6a5e' },
  };

  FC.paint = {
    world(ctx, w, h, m, theme) {
      const pal = WORLD[theme.kind] || WORLD.flip;
      if (!landPath && typeof Path2D !== 'undefined') landPath = new Path2D(FC.WORLD_LAND);
      const sx = w / 360, sy = h / 180;
      const day = document.createElement('canvas');
      day.width = w; day.height = h;
      const d = day.getContext('2d');
      const drawMap = (water, land) => {
        d.fillStyle = water; d.fillRect(0, 0, w, h);
        d.save(); d.scale(sx, sy); d.fillStyle = land; d.fill(landPath);
        if (pal.line) { d.lineWidth = 0.35; d.strokeStyle = pal.line; d.stroke(landPath); }
        d.restore();
      };
      drawMap(pal.water, pal.land);
      ctx.drawImage(day, 0, 0);

      // Night side: the same map in night colours, masked by a soft terminator
      drawMap(pal.nightWater, pal.nightLand);
      const gw = 180, gh = 90, mask = document.createElement('canvas');
      mask.width = gw; mask.height = gh;
      const mc = mask.getContext('2d'), img = mc.createImageData(gw, gh);
      const [slat, slon] = m.sun || [0, 0];
      for (let y = 0; y < gh; y++) {
        const lat = 90 - (y + 0.5) * 180 / gh;
        for (let x = 0; x < gw; x++) {
          const lon = (x + 0.5) * 360 / gw - 180;
          const t = Math.max(0, Math.min(1, (angularDist(lat, lon, slat, slon) - 84) / 12));
          img.data[(y * gw + x) * 4 + 3] = Math.round(t * 255);
        }
      }
      mc.putImageData(img, 0, 0);
      const night = document.createElement('canvas');
      night.width = w; night.height = h;
      const nc = night.getContext('2d');
      nc.imageSmoothingEnabled = true;
      nc.drawImage(mask, 0, 0, w, h);
      nc.globalCompositeOperation = 'source-in';
      nc.drawImage(day, 0, 0);
      ctx.drawImage(night, 0, 0);

      const at = ([lat, lon]) => [(lon + 180) * sx, (90 - lat) * sy];
      const r = Math.max(4, h / 24);
      const [sunX, sunY] = at(m.sun || [0, 0]);
      ctx.fillStyle = theme.kind === 'eink' ? '#d39a2a' : '#ffd23a';
      ctx.beginPath(); ctx.arc(sunX, sunY, r, 0, 7); ctx.fill();
      if (theme.kind === 'flip') { ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(sunX, sunY, r * 2, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      const [mx, my] = at(m.moon || [0, 0]);
      ctx.fillStyle = theme.kind === 'eink' ? '#8d8f86' : '#e9e3c9';
      ctx.beginPath(); ctx.arc(mx, my, r * 0.85, 0, 7); ctx.fill();
      // Moon phase: shade part of the disc (phase 0 new … 4 full … 7)
      const ph = (m.moon_phase ?? 4) / 8, lit = 1 - Math.abs(ph - 0.5) * 2;
      ctx.fillStyle = theme.kind === 'eink' ? '#4c4f55' : '#1a1d22';
      ctx.beginPath();
      ctx.ellipse(mx + (ph < 0.5 ? -1 : 1) * r * 0.85 * lit, my, r * 0.85, r * 0.85, 0, 0, 7);
      if (lit < 0.98) ctx.fill();
    },

    radar(ctx, w, h, m, theme) {
      const eink = theme.kind === 'eink';
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46;
      ctx.strokeStyle = eink ? '#9a9688' : 'rgba(80,220,120,.35)';
      ctx.lineWidth = Math.max(1, h / 160);
      for (const f of [1, 0.66, 0.33]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, 7); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      const [hl, ho] = m.home || [0, 0], rad = m.radius_nm || 30;
      ctx.font = `600 ${Math.round(h / 14)}px -apple-system, Helvetica, sans-serif`;
      for (const p of m.planes || []) {
        const dy = (p.lat - hl) * 60 / rad, dx = (p.lon - ho) * 60 * Math.cos(hl * deg) / rad;
        if (Math.hypot(dx, dy) > 1.05) continue;
        const x = cx + dx * R, y = cy - dy * R;
        ctx.fillStyle = eink ? '#1f5f9e' : '#ffd23a';
        ctx.beginPath(); ctx.arc(x, y, Math.max(3, h / 50), 0, 7); ctx.fill();
        ctx.fillStyle = eink ? '#2b2b29' : '#d8f5dc';
        ctx.fillText(p.callsign || '', x + h / 40, y - h / 60);
      }
      ctx.fillStyle = eink ? '#b0452d' : '#ff6b5a';
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
    },

    iss(ctx, w, h, m, theme) {
      const eink = theme.kind === 'eink';
      const y = h / 2, x0 = w * 0.06, x1 = w * 0.94, x = x0 + (x1 - x0) * (m.progress || 0);
      ctx.lineWidth = Math.max(2, h / 18); ctx.lineCap = 'round';
      ctx.strokeStyle = eink ? '#c9c4b4' : '#333'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.strokeStyle = eink ? '#2f6db0' : '#5aa9ff'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x, y); ctx.stroke();
      const s = h * 0.32;                        // station: body with two solar wings
      ctx.fillStyle = eink ? '#3c3c3a' : '#ffffff';
      ctx.fillRect(x - s * 0.25, y - s * 0.18, s * 0.5, s * 0.36);
      ctx.fillStyle = eink ? '#1f5f9e' : '#6fb6ff';
      ctx.fillRect(x - s * 1.1, y - s * 0.5, s * 0.7, s); ctx.fillRect(x + s * 0.4, y - s * 0.5, s * 0.7, s);
    },

    // The panel's own 64×32 pixels (maze, modules without a layout)
    pixels(ctx, w, h, data, theme) {
      const px = theme.frame;
      if (!px) return;
      const W = 64, H = 32, aw = Math.min(w, h * 2), ah = aw / 2, ox = (w - aw) / 2, oy = (h - ah) / 2;
      const cw = aw / W, ch = ah / H, dim = (data && data.dim) ?? 1;
      const flip = theme.kind === 'flip';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3, r = px[i], g = px[i + 1], b = px[i + 2];
        if (!(r | g | b)) {
          if (flip) { ctx.fillStyle = '#1d1d1f'; ctx.fillRect(ox + x * cw + 0.5, oy + y * ch + 0.5, cw - 1, ch - 1); }
          continue;
        }
        ctx.fillStyle = theme.color([r * dim, g * dim, b * dim], true);
        if (flip) {
          ctx.fillRect(ox + x * cw + 0.5, oy + y * ch + 0.5, cw - 1, ch - 1);
        } else {
          ctx.fillRect(ox + x * cw, oy + y * ch, cw + 0.3, ch + 0.3);
        }
      }
      if (flip) {                                 // hinge line across every tile
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        for (let y = 0; y < H; y++) ctx.fillRect(ox, oy + y * ch + ch / 2, aw, Math.max(0.5, ch / 14));
      }
    },
  };
})(window.FC);
