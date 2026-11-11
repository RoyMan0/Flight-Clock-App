// Now Playing visualizers (desktop only): full-resolution, Winamp / iTunes style, drawn on a
// canvas over the screen while Now Playing's style is "viz_<preset>".
//
// The app never hears the audio, so this runs the same estimate as the Pi's EQ
// (plugins/now_playing/eq.py Analyzer): a beat grid from the song's tempo, anchored to its
// playback position, shaped by energy / danceability / loudness / acousticness. It runs here
// at full frame rate; the model (polled) only tells it the song, its position and pause state.
//
// Presets draw on a fixed-size canvas (≤ 720 px wide, CSS scales it); most use "feedback":
// each frame redraws the last one slightly zoomed / rotated / faded, then adds new lines on
// top, which is what made MilkDrop and the iTunes visualizer swirl.

window.FC = window.FC || {};

(function (FC) {
  const BANDS = 16, TAU = Math.PI * 2;
  const DEFAULTS = { tempo: 110, energy: 0.6, danceability: 0.6, loudness: -8, acousticness: 0.2 };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  function rng(seed) {                    // mulberry32
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- the analyser (a port of eq.py's) --------------------------------------------
  class Analyzer {
    constructor(features, seed) {
      const f = { ...DEFAULTS, ...(features || {}) };
      this.rand = rng(seed);
      this.energy = clamp(f.energy); this.dance = clamp(f.danceability); this.acoustic = clamp(f.acousticness);
      let tempo = f.tempo || 110;
      while (tempo > 180) tempo /= 2;
      while (tempo < 60) tempo *= 2;
      this.bps = tempo / 60;
      this.level = 0.55 + 0.45 * clamp((f.loudness + 20) / 16);
      this.noise = new Array(BANDS).fill(0);
      this.shown = new Array(BANDS).fill(0);
      this.peaks = new Array(BANDS).fill(0);
      this.hold = new Array(BANDS).fill(0);
      this.base = [];
      for (let b = 0; b < BANDS; b++) {
        const x = b / (BANDS - 1);
        const mid = 0.18 * this.acoustic * Math.exp(-((x - 0.45) ** 2) / 0.04);
        const cut = this.acoustic * (0.25 * Math.exp(-x * 8) + 0.15 * x ** 3);
        this.base.push(Math.max(0.08, 0.55 - 0.3 * x + mid - cut));
      }
      this.kick = 0;
    }

    // Levels for song time t (s); `dt` scales the fall rates to the frame rate (the Pi runs ~30 fps)
    levels(t, playing, dt) {
      const k = clamp(dt * 30, 0.2, 3);
      const beat = t * this.bps, ph = beat % 1, n = Math.floor(beat), ph8 = (beat * 2) % 1;
      const kick = Math.exp(-ph * 7) * (0.45 + 0.55 * this.energy) * (1 - 0.5 * this.acoustic);
      const snare = n % 2 === 1 ? Math.exp(-ph * 9) * (0.3 + 0.5 * this.energy) : 0;
      const hat = Math.exp(-ph8 * 14) * (0.15 + 0.6 * this.dance) * (1 - 0.6 * this.acoustic);
      this.kick = playing ? kick : 0;
      for (let b = 0; b < BANDS; b++) {
        const x = b / (BANDS - 1);
        this.noise[b] = (this.noise[b] + (this.rand() - 0.5) * 0.4 * Math.sqrt(k)) * Math.pow(0.82, k);
        let v = this.base[b] * (0.65 + 0.35 * this.energy);
        v += kick * Math.exp(-((x - 0.08) ** 2) / 0.02);
        v += snare * Math.exp(-((x - 0.42) ** 2) / 0.03);
        v += hat * Math.exp(-((x - 0.85) ** 2) / 0.03);
        v += this.noise[b] * (0.25 + 0.35 * this.energy);
        const tgt = playing ? 1 - Math.exp(-2.4 * Math.max(0, v * this.level)) : 0;
        this.shown[b] = tgt > this.shown[b] ? tgt : Math.max(tgt, this.shown[b] - 0.07 * k);
        if (this.shown[b] >= this.peaks[b]) { this.peaks[b] = this.shown[b]; this.hold[b] = 6; }
        else if (this.hold[b] > 0) this.hold[b] -= k;
        else this.peaks[b] = Math.max(0, this.peaks[b] - 0.035 * k);
      }
    }

    // A waveform (-1..1) from the levels, as eq.py wave_samples (golden-angle phases)
    wave(n, t, out) {
      out = out || new Float32Array(n);
      let peak = 1.5;
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        let v = 0;
        for (let b = 0; b < BANDS; b++) {
          const f = 0.5 + 0.8 * Math.pow(b, 1.15), ph = b * b * 2.39996, sp = 0.8 + 2.4 * ((b * 0.618034) % 1);
          v += this.shown[b] * Math.sin(TAU * f * x + ph + t * sp) / (1 + b * 0.2);
        }
        out[i] = v;
        peak = Math.max(peak, Math.abs(v));
      }
      for (let i = 0; i < n; i++) out[i] /= peak;
      return out;
    }
  }
  FC.VizAnalyzer = Analyzer;

  // ---- helpers ----------------------------------------------------------------------
  const avg = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s / (i1 - i0); };
  const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

  // Redraw the last frame transformed (the feedback trick): zoom about the centre, rotate, fade
  function feedback(v, { zoom = 1, rot = 0, alpha = 0.9, fade = 'rgba(0,0,0,1)', dx = 0, dy = 0 }) {
    const { ctx, buf, bctx, W, H } = v;
    bctx.globalCompositeOperation = 'copy';
    bctx.drawImage(v.scene, 0, 0);
    bctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + dx, H / 2 + dy);
    ctx.rotate(rot);
    ctx.scale(zoom, zoom);
    ctx.drawImage(buf, -W / 2, -H / 2);
    ctx.restore();
  }

  // 32 display bars from the 16 bands (neighbours blended, so it reads as a finer analyser)
  function bars32(a) {
    const out = new Float32Array(32);
    for (let i = 0; i < 32; i++) {
      const p = i / 31 * (BANDS - 1), i0 = Math.floor(p), f = p - i0;
      out[i] = a[i0] * (1 - f) + a[Math.min(BANDS - 1, i0 + 1)] * f;
    }
    return out;
  }

  // ---- presets ----------------------------------------------------------------------
  // Each: { name, frame(v, a), overlay?(v, a, octx) }. frame draws the scene (v.ctx, which the
  // feedback reuses next frame); overlay draws crisp things on the visible canvas only, so they
  // don't smear into the feedback. v: {ctx, W, H, t, dt, state, rand, seed}, a: the audio frame
  const PRESETS = {
    // Image: a green/red tunnel sucking everything to a dark centre with a red ember
    vortex: {
      name: 'Vortex',
      frame(v, a) {
        const { ctx, W, H } = v;
        feedback(v, { zoom: 0.975 - a.bassS * 0.008, rot: 0.005 + a.bassS * 0.008, alpha: 0.965, fade: 'rgba(5,7,9,1)' });
        const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) * 0.5, w = a.wave, n = w.length;
        ctx.save();
        ctx.lineCap = 'round';
        const strands = 4 + Math.round(a.levelS * 7);
        for (let s = 0; s < strands; s++) {          // short arcs of green fire / dark red around the rim
          const start = v.rand() * TAU, span = 0.4 + v.rand() * 1.4, rad = R * (0.72 + v.rand() * 0.3);
          const red = v.rand() < 0.3, seg = 24;
          ctx.beginPath();
          for (let i = 0; i <= seg; i++) {
            const ang = start + (i / seg) * span, k = Math.floor((i / seg) * (n - 1) + s * 13) % n;
            const r = rad * (1 + 0.05 * w[k] * (0.6 + a.level));
            const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.6;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.strokeStyle = red ? hsl(352, 75, 20 + v.rand() * 10, 0.85) : hsl(105 + v.rand() * 25, 85, 32 + v.rand() * 25 + a.mid * 12, 0.8);
          ctx.lineWidth = (red ? 5 : 1.5) + v.rand() * 3 + a.bass * 5;
          ctx.stroke();
        }
        ctx.restore();
      },
      overlay(v, a, o) {
        const { W, H } = v;
        const ember = 3 + a.kickS * 6;
        o.save();
        o.fillStyle = hsl(5, 100, 55, 0.95);
        o.shadowColor = 'red'; o.shadowBlur = 14;
        o.fillRect(W / 2 - ember / 2, H / 2 - ember / 2, ember, ember);
        o.restore();
        o.strokeStyle = hsl(118, 80, 50); o.lineWidth = 4;
        o.strokeRect(2, 2, W - 4, H - 4);
        o.strokeStyle = hsl(350, 70, 22); o.lineWidth = 3;
        o.strokeRect(6, 6, W - 12, H - 12);
      },
    },

    // Classic Winamp bars: segmented, gradient, falling peak caps; a palette per song
    spectrum: {
      name: 'Spectrum',
      frame(v, a) {
        const { ctx, W, H } = v;
        const pals = [['#ffe14a', '#ff9a1a', '#e2290f'], ['#ffffff', '#b9bec6', '#5a5f68'], ['#7dffef', '#2bb7ff', '#3b3bd0'],
                      ['#d6ff5c', '#3fd24a', '#0b6b2a']];
        const pal = pals[v.state.palette ?? (v.state.palette = v.seed % pals.length)];
        ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 1;
        for (let y = H; y > 0; y -= H / 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        const bars = bars32(a.bands), peaks = bars32(a.peaks);
        const bw = W / 32, top = H * 0.06, h = H - top - 4;
        const g = ctx.createLinearGradient(0, top, 0, H);
        g.addColorStop(0, pal[0]); g.addColorStop(0.45, pal[1]); g.addColorStop(1, pal[2]);
        for (let i = 0; i < 32; i++) {
          const x = i * bw + 1, bh = bars[i] * h;
          ctx.fillStyle = g;
          ctx.fillRect(x, H - 4 - bh, bw - 3, bh);
          ctx.fillStyle = 'rgba(0,0,0,.55)';           // segment gaps
          for (let y = H - 4; y > H - 4 - bh; y -= 5) ctx.fillRect(x, y - 1, bw - 3, 1.5);
          ctx.fillStyle = '#f2f2f2';
          ctx.fillRect(x, H - 4 - peaks[i] * h - 3, bw - 3, 2);
        }
      },
    },

    // A reflected spectrum on a horizon: cyan → pink bars with a mirror below
    reflection: {
      name: 'Reflection',
      frame(v, a) {
        const { ctx, W, H } = v;
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#120a2a'); bg.addColorStop(0.62, '#2a1650'); bg.addColorStop(1, '#0a0618');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        const n = 64, bw = W / n, horizon = H * 0.62;
        const src = bars32(a.bands);
        const g = ctx.createLinearGradient(0, horizon - H * 0.55, 0, horizon);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, '#ff6ad5'); g.addColorStop(0.7, '#3fd6ff'); g.addColorStop(1, '#2a7bff');
        for (let i = 0; i < n; i++) {
          const k = i < n / 2 ? n / 2 - 1 - i : i - n / 2;   // low in the middle, mirrored out
          const lv = src[Math.min(31, k)] * (0.85 + 0.15 * Math.sin(v.t * 3 + i));
          const h = lv * H * 0.55, x = i * bw;
          ctx.fillStyle = g;
          ctx.fillRect(x + 0.5, horizon - h, bw - 1, h);
          ctx.globalAlpha = 0.28;
          ctx.fillRect(x + 0.5, horizon + 1, bw - 1, h * 0.55);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.fillRect(0, horizon, W, 1);
      },
    },

    // Warp-speed streaks pouring out of the centre with a white oscilloscope line
    rays: {
      name: 'Warp Rays',
      frame(v, a) {
        const { ctx, W, H } = v;
        // A slow surge (a few tens of seconds, louder = bigger): from short streaks around the
        // centre up to a full-screen warp, with the zoom speeding up to match
        const surge = (0.5 + 0.5 * Math.sin(v.ph * 0.22)) * (0.4 + 0.9 * a.levelS);
        feedback(v, { zoom: 1.016 + a.bassS * 0.01 + surge * 0.025, alpha: 0.9, fade: 'rgba(0,0,0,1)' });
        const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const count = 3 + Math.round(a.levelS * 6 + a.kickS * 4 + surge * 10);
        const hue0 = 140 + Math.sin(v.ph * 0.1) * 70;               // green ↔ cyan ↔ violet over time
        for (let i = 0; i < count; i++) {
          const ang = v.rand() * TAU, r0 = 4 + v.rand() * (12 + surge * R * 0.3);
          const r1 = r0 + R * (0.06 + v.rand() * (0.12 + 0.75 * surge + 0.25 * a.kickS));
          ctx.strokeStyle = hsl(hue0 + v.rand() * 60, 70, 35 + v.rand() * 30, 0.5);
          ctx.lineWidth = 1 + v.rand() * 3;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.6);
          ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.6);
          ctx.stroke();
        }
        ctx.restore();
      },
      overlay(v, a, o) {                                 // the scope, crisp on top
        const { W, H } = v, w = a.wave, n = w.length;
        for (const [lw, col] of [[4, 'rgba(120,255,200,.18)'], [1.3, 'rgba(235,255,245,.92)']]) {
          o.strokeStyle = col; o.lineWidth = lw;
          o.beginPath();
          for (let i = 0; i < n; i++) {
            const x = i / (n - 1) * W, y = H / 2 + w[i] * H * 0.28 * (0.4 + a.level);
            i ? o.lineTo(x, y) : o.moveTo(x, y);
          }
          o.stroke();
        }
      },
    },

    // 8-way symmetric wavy star: radial waveforms in pink, white, yellow and blue
    kaleido: {
      name: 'Kaleidoscope',
      frame(v, a) {
        const { ctx, W, H } = v;
        // Breathes: the arms reach from a small star out past the edges and back, and the
        // symmetry changes every so often (6, 8, 10 or 12 arms)
        const breath = 0.5 + 0.5 * Math.sin(v.ph * 0.35);
        feedback(v, { zoom: 1.012 + 0.018 * a.levelS, rot: -0.004, alpha: 0.82, fade: 'rgba(0,0,0,1)' });
        const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2, w = a.wave, n = w.length;
        const cols = [hsl(330, 90, 60), hsl(0, 0, 95), hsl(55, 90, 65), hsl(200, 80, 60)];
        const arms = [8, 6, 10, 12][Math.floor(v.ph / 16) % 4];
        const reach = R * (0.3 + 0.75 * breath + 0.2 * a.levelS);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.lineWidth = 1.6 + a.bass * 2;
        for (let arm = 0; arm < arms; arm++) {
          ctx.save();
          ctx.rotate(arm * TAU / arms + v.ph * 0.12);
          if (arm % 2) ctx.scale(1, -1);
          ctx.strokeStyle = cols[(arm + Math.floor(v.ph / 4)) % cols.length];
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const r = 0.04 * R + (i / (n - 1)) * reach;
            const off = w[i] * R * (0.05 + 0.08 * breath) * (0.5 + a.level);
            i ? ctx.lineTo(r, off) : ctx.moveTo(r, off);
          }
          ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 0.05 * R * (1 + a.kickS * 0.4), 0, TAU); ctx.stroke();
        ctx.restore();
      },
    },

    // Swirling rainbow plasma around a dark eye (computed small, scaled up smoothly)
    plasma: {
      name: 'Plasma',
      frame(v, a) {
        const { ctx, W, H } = v;
        const PW = 128, PH = 64, st = v.state;
        if (!st.small) {
          st.small = document.createElement('canvas'); st.small.width = PW; st.small.height = PH;
          st.sctx = st.small.getContext('2d'); st.img = st.sctx.createImageData(PW, PH);
          st.p = 0;
        }
        // Its own clock: always moving, faster in loud passages (smoothed, so it never jerks)
        st.p += v.dt * (0.3 + 0.8 * a.levelS);
        const d = st.img.data, t = st.p, twist = 2.2 + a.bassS * 1.2, hue0 = t * 18;
        const glow = 0.5 + 0.12 * a.mid + 0.25 * a.kickS;                 // brightens on the beat
        for (let y = 0; y < PH; y++) {
          for (let x = 0; x < PW; x++) {
            const nx = (x - PW / 2) / (PH / 2), ny = (y - PH / 2) / (PH / 2);
            const r = Math.sqrt(nx * nx + ny * ny), th = Math.atan2(ny, nx) + twist / (r + 0.35) - t * 0.6;
            const val = Math.sin(th * 3 + t) + Math.sin(r * 4.5 - t * 1.7 + Math.sin(th * 2 + t * 0.5)) +
                        Math.sin(nx * 2.2 + t * 0.9) * 0.5;
            const h = (hue0 + val * 70 + r * 40) % 360;
            const light = Math.min(1, r * (1.4 + 0.5 * a.kickS)) * glow;   // dark eye in the middle
            const [rr, gg, bb] = hslRgb(h / 360, 0.85, light * 0.6);
            const i = (y * PW + x) * 4;
            d[i] = rr; d[i + 1] = gg; d[i + 2] = bb; d[i + 3] = 255;
          }
        }
        st.sctx.putImageData(st.img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(st.small, 0, 0, W, H);
      },
    },

    // Red spiral arms (rotating logarithmic spirals, widening outward) with lightning
    // crackling out of the centre
    spiral: {
      name: 'Red Spiral',
      frame(v, a) {
        const { ctx, W, H } = v;
        feedback(v, { zoom: 0.997, rot: 0.003, alpha: 0.55, fade: 'rgba(10,0,0,1)' });
        v.state.spin = (v.state.spin || 0) + v.dt * (0.3 + a.bassS * 0.4);
        const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) * 0.55, arms = 6, turns = 1.6;
        const b = Math.log(R / 4) / (turns * TAU);          // r = 4·e^(bθ) reaches R at the end
        ctx.save();
        ctx.lineCap = 'round';
        for (let arm = 0; arm < arms; arm++) {
          const rot = arm * TAU / arms + v.state.spin;
          let px = cx, py = cy;
          for (let k = 1; k <= 90; k++) {
            const th = (k / 90) * turns * TAU, r = 4 * Math.exp(b * th);
            const x = cx + Math.cos(th + rot) * r, y = cy + Math.sin(th + rot) * r * 0.62;
            ctx.strokeStyle = arm % 2 ? hsl(352, 80, 16 + r / R * 10, 0.9) : hsl(2, 92, 30 + r / R * 22 + a.mid * 10, 0.9);
            ctx.lineWidth = 1 + r * (arm % 2 ? 0.16 : 0.1) * (1 + a.bass * 0.5);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
            px = x; py = y;
          }
        }
        ctx.restore();
      },
      overlay(v, a, o) {
        const { W, H } = v, R = Math.hypot(W, H) * 0.5, w = a.wave, n = w.length;
        o.save();
        o.translate(W / 2, H / 2);
        o.lineJoin = 'round';
        for (let bolt = 0; bolt < 3; bolt++) {           // jagged lightning from the waveform
          o.save();
          o.rotate(v.ph * 0.3 + bolt * TAU / 3 + Math.sin(v.ph * 0.9 + bolt) * 0.4);
          o.beginPath();
          for (let i = 0; i < n; i += 2) {
            const r = (i / (n - 1)) * R * 0.8 * (0.5 + a.level * 0.6);
            const off = w[(i * 7 + bolt * 11) % n] * 12 * (0.4 + a.treble);
            i ? o.lineTo(r, off) : o.moveTo(r, off);
          }
          o.strokeStyle = hsl(15, 100, 78, 0.95); o.lineWidth = 1.5;
          o.shadowColor = '#ff2a10'; o.shadowBlur = 12;
          o.stroke();
          o.restore();
        }
        o.fillStyle = '#fff';
        o.beginPath(); o.arc(0, 0, 2 + a.kickS * 3, 0, TAU); o.fill();
        o.restore();
      },
    },
  };

  // ---- the Pi's EQ styles on the flip-board and e-ink screens -----------------------------
  // The same pictures as plugins/now_playing/eq.py, sampled on a grid of tiles and drawn as
  // split flaps (flip board) or as ink dots on paper (e-ink). cell(c, r) → [r,g,b] or null.
  const hsv = (h, s, v) => {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [r * 255, g * 255, b * 255];
  };
  const barColour = (b, frac, hue) => hsv(b / BANDS * 0.85 + hue, 1, 0.55 + 0.45 * frac);
  const WHITE = [235, 235, 235];

  function drawTiles(v, cols, rows, cell) {
    const { ctx, W } = v, H = v.VH, eink = v.skin === 'eink';
    const tw = W / cols, th = H / rows;
    ctx.fillStyle = eink ? '#e8e4d8' : '#0b0b0c';
    ctx.fillRect(0, 0, W, v.H);
    const gap = Math.max(1, Math.min(tw, th) * (eink ? 0.16 : 0.1));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = cell(c, r), x = c * tw + gap / 2, y = r * th + gap / 2, w = tw - gap, h = th - gap;
        if (eink) {
          if (!col) continue;
          ctx.fillStyle = FC.inkColor ? FC.inkColor(col.map(Math.round), true) : `rgb(${col.map(Math.round)})`;
          ctx.fillRect(x, y, w, h);
        } else {
          ctx.fillStyle = col ? `rgb(${col.map(Math.round)})` : '#1b1b1d';
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = 'rgba(255,255,255,.06)';           // the upper flap catches the light
          ctx.fillRect(x, y, w, h / 2);
          ctx.fillStyle = 'rgba(0,0,0,.6)';                  // the hinge
          ctx.fillRect(x, y + h / 2 - Math.max(0.5, h * 0.03), w, Math.max(1, h * 0.06));
        }
      }
    }
  }

  const BOARD = {
    eq: {
      frame(v, a) {
        const cols = 48, rows = 16, hue = v.state.hue;      // 3 columns per band: 2 lit + a gap
        drawTiles(v, cols, rows, (c, r) => {
          if (c % 3 === 2) return null;
          const b = Math.floor(c / 3), up = rows - 1 - r;
          const lit = Math.round(a.bands[b] * rows), pk = Math.round(a.peaks[b] * rows);
          if (up < lit) return barColour(b, up / (rows - 1), hue);
          return pk > lit && up === pk - 1 ? WHITE : null;
        });
      },
    },
    eq_mirror: {
      frame(v, a) {
        const cols = 48, rows = 16, half = rows / 2, hue = v.state.hue;
        drawTiles(v, cols, rows, (c, r) => {
          if (c % 3 === 2) return null;
          const b = Math.floor(c / 3), lit = Math.round(a.bands[b] * half), down = r >= half;
          const s = down ? r - half : half - 1 - r;
          if (s < lit) {
            const col = hsv(0.5 + 0.35 * s / (half - 1) + hue, 0.85, 0.6 + 0.4 * s / (half - 1));
            return down ? col.map((x) => x * 0.4) : col;
          }
          const pk = Math.round(a.peaks[b] * half);
          return !down && pk > lit && s === pk - 1 ? WHITE : null;
        });
      },
    },
    eq_wave: {
      frame(v, a) {
        const cols = 64, rows = 22, st = v.state, w = a.wave, n = w.length;
        const amp = (rows / 2 - 1.5) * (0.35 + 0.65 * a.level);
        const ys = [];
        for (let c = 0; c < cols; c++) ys.push(Math.round(Math.max(0, Math.min(rows - 1, (rows - 1) / 2 + amp * w[Math.round(c / (cols - 1) * (n - 1))]))));
        st.trail = [ys, ...(st.trail || [])].slice(0, v.skin === 'eink' ? 1 : 4);   // phosphor trails (not on paper)
        const green = hsv(0.36 + st.hue, 0.7, 1);
        drawTiles(v, cols, rows, (c, r) => {
          for (let k = 0; k < st.trail.length; k++) {
            const t = st.trail[k], y = t[c], p = c ? t[c - 1] : y;
            if (r >= Math.min(y, p) && r <= Math.max(y, p)) return green.map((x) => x * Math.pow(0.55, k));
          }
          return null;
        });
      },
    },
    eq_burst: {
      frame(v, a) {
        const cols = 64, rows = 30, st = v.state;
        st.spin = (st.spin || 0) + v.dt * 0.15 * 1.5;
        const core = 1 + 2 * a.bands[0];
        drawTiles(v, cols, rows, (c, r) => {
          const dx = c + 0.5 - 32, dy = (r + 0.5 - rows / 2) / 0.55, dist = Math.hypot(dx, dy);
          if (dist <= core) return WHITE;
          if (dist < 3) return null;
          let ang = Math.atan2(dy, dx) - st.spin;
          ang = ((ang % TAU) + TAU) % TAU;
          const k = Math.round(ang / TAU * 32) % 32, off = Math.abs(ang - k * TAU / 32);
          if (Math.min(off, TAU - off) * dist > 0.75) return null;       // only near the spoke's line
          const q = k % 16;
          const band = Math.min(BANDS - 1, (q < 8 ? q : 15 - q) * 2 + Math.floor(k / 16));
          if (dist > 4 + a.bands[band] * 38) return null;
          return hsv(band / BANDS * 0.8 + st.hue, 1, 1 - 0.6 * Math.min(1, dist / 31));
        });
      },
    },
  };

  const CYCLE = ['vortex', 'spectrum', 'rays', 'kaleido', 'plasma', 'reflection', 'spiral'];
  FC.VIZ_PRESETS = PRESETS;

  function hslRgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }

  // ---- the visualizer layer ---------------------------------------------------------
  FC.Viz = class {
    constructor(root) {
      this.canvas = document.createElement('canvas');      // what's shown: the scene + overlays
      this.canvas.id = 'viz';
      this.octx = this.canvas.getContext('2d');
      this.scene = document.createElement('canvas');       // what the presets draw (and feed back)
      this.ctx = this.scene.getContext('2d');
      this.buf = document.createElement('canvas');
      this.bctx = this.buf.getContext('2d');
      this.info = document.createElement('div');
      this.info.id = 'viz-info';
      this.bar = document.createElement('div');            // progress, with show_info
      this.bar.id = 'viz-progress';
      this.bar.innerHTML = '<span></span>';
      this.paused = document.createElement('div');
      this.paused.id = 'viz-paused';
      this.paused.innerHTML = '<span></span><span></span>';
      root.append(this.canvas, this.info, this.bar, this.paused);
      this.screen = 'led';
      this.sm = { bass: 0, level: 0, kick: 0 };              // smoothed audio, for motion
      this.active = false;
      this.model = null;
      this.analyzer = null;
      this.trackKey = null;
      this.preset = null;
      this.state = {};
      this.rand = rng(7);
      this.wave = new Float32Array(160);
      this.last = 0;
      this.loop = this.loop.bind(this);
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const W = Math.max(160, Math.min(720, Math.round(r.width * (window.devicePixelRatio || 1))));
      const H = Math.round(W * Math.max(0.3, r.height / Math.max(1, r.width)));
      if (W !== this.W || H !== this.H) {
        this.W = this.canvas.width = this.scene.width = this.buf.width = W;
        this.H = this.canvas.height = this.scene.height = this.buf.height = H;
        this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, W, H);
      }
    }

    // The screen style: the Pi's EQ styles are drawn here on the flip board and e-ink (the LED
    // screen shows the Pi's own pixels for them)
    setScreen(screen) {
      if (screen === this.screen) return;
      this.screen = screen;
      const m = this.model || this.lastModel;
      this.model = null;
      this.choice = null;
      this.setModel(m);
    }

    // What to draw for a Now Playing model: [preset key, board skin or null], or null for nothing
    pick(model) {
      const style = String((model && model.style) || '');
      if (style.startsWith('viz_')) return [style.slice(4), null];
      const eq = style === 'eq_text' ? 'eq' : style;
      if (BOARD[eq] && (this.screen === 'flipboard' || this.screen === 'eink')) return ['board:' + eq, this.screen];
      return null;
    }

    // model: Now Playing's describe() (style "viz_<preset>", or an EQ style on a board screen), or null to hide
    setModel(model) {
      this.lastModel = model;
      const pick = model ? this.pick(model) : null;
      const on = !!pick;
      if (on !== this.active) {
        this.active = on;
        document.body.classList.toggle('viz-on', on);
        if (on) { this.resize(); this.last = 0; requestAnimationFrame(this.loop); }
      }
      if (!on) { this.model = null; document.body.classList.remove('viz-strip', 'viz-keep'); return; }
      const now = performance.now();
      const key = `${model.title}|${model.artist}`;
      const pos = Number(model.position) || 0;
      const newSong = key !== this.trackKey;
      if (newSong) {
        this.trackKey = key;
        this.seed = (model.seed || 1) >>> 0;
        this.analyzer = new Analyzer(model.features, this.seed);
        this.info.textContent = `${model.artist ? model.artist + ' — ' : ''}${model.title || ''}`;
        this.showInfo();
        if (this.choice === 'cycle') this.pickCycle(true);
      }
      // A steady clock: follow our own time between polls, and only re-sync to the app's
      // position when it drifts (a seek, a pause) — re-anchoring every poll made it stutter
      const local = this.pos0 == null ? null : this.pos0 + (this.model && !this.model.paused ? (now - this.t0) / 1000 : 0);
      if (newSong || local == null || !!model.paused !== !!(this.model && this.model.paused) || Math.abs(local - pos) > 0.75) {
        this.pos0 = pos;
        this.t0 = now;
      } else if (this.model && !this.model.paused) {
        this.pos0 = local;
        this.t0 = now;
      }
      this.model = model;
      const [choice, skin] = pick;
      this.skin = skin;
      if (choice !== this.choice) {
        this.choice = choice;
        if (choice === 'cycle') this.pickCycle(true);
        else this.setPreset(choice.startsWith('board:') || PRESETS[choice] ? choice : 'vortex');
      }
      // Song info: kept on screen with show_info (the board styles in a strip under the
      // visual, like the Pi), otherwise only for a few seconds when a song starts
      const keep = model.show_info !== false;
      document.body.classList.toggle('viz-strip', !!skin && keep);
      document.body.classList.toggle('viz-keep', keep);
      this.bar.firstChild.style.width = `${Math.round((model.progress || 0) * 1000) / 10}%`;
      this.bar.style.visibility = model.progress == null ? 'hidden' : '';
      document.body.classList.toggle('viz-paused', !!model.paused);
    }

    setPreset(name) {
      if (name === this.preset) return;
      this.preset = name;
      this.state = {};
      this.cycleAt = performance.now();
      if (this.W) { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.W, this.H); }
    }

    pickCycle(newSong) {
      const i = CYCLE.indexOf(this.preset);
      this.setPreset(CYCLE[(i + 1) % CYCLE.length]);
      if (newSong) this.cycleAt = performance.now();
    }

    showInfo() {
      this.info.classList.add('on');
      clearTimeout(this.infoTimer);
      this.infoTimer = setTimeout(() => this.info.classList.remove('on'), 7000);
    }

    // Draw one frame at time `now` (ms); `dt` in seconds
    render(now, dt) {
      const m = this.model, an = this.analyzer;
      const board = String(this.preset || '').startsWith('board:');
      const p = board ? BOARD[this.preset.slice(6)] : PRESETS[this.preset];
      if (!m || !an || !p || !this.W) return;
      const playing = !m.paused;
      const t = this.pos0 + (playing ? (now - this.t0) / 1000 : 0);
      an.levels(t, playing, dt);
      if (!playing && !board) return;                  // paused: hold the last frame (dimmed in CSS)
      if (this.choice === 'cycle' && now - this.cycleAt > 30000) this.pickCycle(false);
      const b = an.shown, sm = this.sm;
      const bass = avg(b, 0, 3), level = avg(b, 0, 16);
      // Smoothed copies for anything that moves things (speeds, sizes): raw levels jump every beat
      const k = 1 - Math.exp(-dt * 4), kk = 1 - Math.exp(-dt * 14);
      sm.bass += (bass - sm.bass) * k; sm.level += (level - sm.level) * k; sm.kick += (an.kick - sm.kick) * kk;
      this.ph = (this.ph || 0) + dt * (0.6 + 0.8 * sm.level);    // a music-paced clock for motion
      const audio = {
        bands: b, peaks: an.peaks, kick: an.kick,
        bass, mid: avg(b, 4, 10), treble: avg(b, 10, 16), level,
        bassS: sm.bass, levelS: sm.level, kickS: sm.kick,
        wave: an.wave(this.wave.length, t, this.wave),
      };
      this.state.hue = ((this.state.hue || 0) + (playing ? dt * 0.015 : 0)) % 1;
      const strip = board && document.body.classList.contains('viz-strip');
      const v = { ctx: this.ctx, buf: this.buf, bctx: this.bctx, scene: this.scene, W: this.W, H: this.H,
                  VH: strip ? Math.round(this.H * 0.74) : this.H, skin: this.skin,
                  t, ph: this.ph, dt, state: this.state, rand: this.rand, seed: this.seed };
      p.frame(v, audio);
      this.octx.globalCompositeOperation = 'copy';
      this.octx.drawImage(this.scene, 0, 0);
      this.octx.globalCompositeOperation = 'source-over';
      if (p.overlay) p.overlay(v, audio, this.octx);
    }

    loop(ts) {
      if (!this.active) return;
      requestAnimationFrame(this.loop);
      // At most 60 frames a second (a 120 Hz display ran the feedback presets twice as fast);
      // e-ink, like a real panel, updates a few times a second
      const every = this.skin === 'eink' ? 250 : 1000 / 61;
      if (this.last && ts - this.last < every) return;
      const dt = this.last ? Math.min(0.25, (ts - this.last) / 1000) : 1 / 60;
      this.last = ts;
      this.render(ts, dt);
    }

    // Tests and snapshots (offscreen windows don't run requestAnimationFrame): step n frames
    step(n = 60) {
      let ts = this.t0 || performance.now();
      for (let i = 0; i < n; i++) { ts += 1000 / 60; this.render(ts, 1 / 60); }
    }
  };
})(window.FC);
