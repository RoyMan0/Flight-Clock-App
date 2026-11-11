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
        feedback(v, { zoom: 0.958 - a.bass * 0.012, rot: 0.016 + a.bass * 0.03, alpha: 0.965, fade: 'rgba(5,7,9,1)' });
        const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) * 0.5, w = a.wave, n = w.length;
        ctx.save();
        ctx.lineCap = 'round';
        const strands = 7 + Math.round(a.level * 10);
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
        const ember = 3 + a.kick * 6;
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
        feedback(v, { zoom: 1.045 + a.bass * 0.03, alpha: 0.88, fade: 'rgba(0,0,0,1)' });
        const cx = W / 2, cy = H / 2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const count = 6 + Math.round(a.level * 14);
        for (let i = 0; i < count; i++) {
          const ang = v.rand() * TAU, r0 = 4 + v.rand() * 20, r1 = r0 + 20 + v.rand() * (40 + a.treble * 120);
          ctx.strokeStyle = hsl(140 + v.rand() * 60 + Math.sin(v.t * 0.2) * 30, 70, 35 + v.rand() * 30, 0.5);
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
        feedback(v, { zoom: 1.018, rot: -0.004, alpha: 0.82, fade: 'rgba(0,0,0,1)' });
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.95, w = a.wave, n = w.length;
        const cols = [hsl(330, 90, 60), hsl(0, 0, 95), hsl(55, 90, 65), hsl(200, 80, 60)];
        ctx.save();
        ctx.translate(cx, cy);
        ctx.lineWidth = 1.6 + a.bass * 2;
        for (let arm = 0; arm < 8; arm++) {
          ctx.save();
          ctx.rotate(arm * TAU / 8 + v.t * 0.15);
          if (arm % 2) ctx.scale(1, -1);
          ctx.strokeStyle = cols[(arm + Math.floor(v.t / 4)) % cols.length];
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const r = 0.06 * R + (i / (n - 1)) * R * 0.5;
            const off = w[i] * R * 0.07 * (0.5 + a.level);
            i ? ctx.lineTo(r, off) : ctx.moveTo(r, off);
          }
          ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 0.05 * R * (1 + a.kick * 0.4), 0, TAU); ctx.stroke();
        ctx.restore();
      },
    },

    // Swirling rainbow plasma around a dark eye (computed small, scaled up smoothly)
    plasma: {
      name: 'Plasma',
      frame(v, a) {
        const { ctx, W, H } = v;
        const PW = 96, PH = 48, st = v.state;
        if (!st.small) {
          st.small = document.createElement('canvas'); st.small.width = PW; st.small.height = PH;
          st.sctx = st.small.getContext('2d'); st.img = st.sctx.createImageData(PW, PH);
        }
        const d = st.img.data, t = v.t, twist = 2.2 + a.bass * 2.5, hue0 = t * 12;
        for (let y = 0; y < PH; y++) {
          for (let x = 0; x < PW; x++) {
            const nx = (x - PW / 2) / (PH / 2), ny = (y - PH / 2) / (PH / 2);
            const r = Math.sqrt(nx * nx + ny * ny), th = Math.atan2(ny, nx) + twist / (r + 0.35) - t * 0.6;
            const val = Math.sin(th * 3 + t) + Math.sin(r * 4.5 - t * 1.7 + Math.sin(th * 2 + t * 0.5)) +
                        Math.sin(nx * 2.2 + t * 0.9) * 0.5;
            const h = (hue0 + val * 70 + r * 40) % 360;
            const light = Math.min(1, r * 1.6) * (0.55 + 0.15 * a.mid);   // dark eye in the middle
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
        feedback(v, { zoom: 0.995, rot: 0.01, alpha: 0.55, fade: 'rgba(10,0,0,1)' });
        const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) * 0.55, arms = 6, turns = 1.6;
        const b = Math.log(R / 4) / (turns * TAU);          // r = 4·e^(bθ) reaches R at the end
        ctx.save();
        ctx.lineCap = 'round';
        for (let arm = 0; arm < arms; arm++) {
          const rot = arm * TAU / arms + v.t * (0.7 + a.bass * 0.6);
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
          o.rotate(v.t * 0.5 + bolt * TAU / 3 + Math.sin(v.t * 1.3 + bolt) * 0.4);
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
        o.beginPath(); o.arc(0, 0, 2 + a.kick * 3, 0, TAU); o.fill();
        o.restore();
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
      this.paused = document.createElement('div');
      this.paused.id = 'viz-paused';
      this.paused.innerHTML = '<span></span><span></span>';
      root.append(this.canvas, this.info, this.paused);
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

    // model: Now Playing's describe() (style "viz_<preset>"), or null to hide
    setModel(model) {
      const on = !!model && String(model.style || '').startsWith('viz_');
      if (on !== this.active) {
        this.active = on;
        document.body.classList.toggle('viz-on', on);
        if (on) { this.resize(); this.last = 0; requestAnimationFrame(this.loop); }
      }
      if (!on) { this.model = null; return; }
      const key = `${model.title}|${model.artist}`;
      if (key !== this.trackKey) {
        this.trackKey = key;
        this.seed = (model.seed || 1) >>> 0;
        this.analyzer = new Analyzer(model.features, this.seed);
        this.info.textContent = `${model.artist ? model.artist + ' — ' : ''}${model.title || ''}`;
        this.showInfo();
        if (this.choice === 'cycle') this.pickCycle(true);
      }
      this.model = model;
      this.pos0 = Number(model.position) || 0;
      this.t0 = performance.now();
      const choice = String(model.style).slice(4);
      if (choice !== this.choice) {
        this.choice = choice;
        if (choice === 'cycle') this.pickCycle(true);
        else this.setPreset(PRESETS[choice] ? choice : 'vortex');
      }
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
      const m = this.model, an = this.analyzer, p = PRESETS[this.preset];
      if (!m || !an || !p || !this.W) return;
      const playing = !m.paused;
      const t = this.pos0 + (playing ? (now - this.t0) / 1000 : 0);
      an.levels(t, playing, dt);
      if (!playing) return;                            // paused: hold the last frame (dimmed in CSS)
      if (this.choice === 'cycle' && now - this.cycleAt > 30000) this.pickCycle(false);
      const b = an.shown;
      const audio = {
        bands: b, peaks: an.peaks, kick: an.kick,
        bass: avg(b, 0, 3), mid: avg(b, 4, 10), treble: avg(b, 10, 16), level: avg(b, 0, 16),
        wave: an.wave(this.wave.length, t, this.wave),
      };
      const v = { ctx: this.ctx, buf: this.buf, bctx: this.bctx, scene: this.scene, W: this.W, H: this.H,
                  t, dt, state: this.state, rand: this.rand, seed: this.seed };
      p.frame(v, audio);
      this.octx.globalCompositeOperation = 'copy';
      this.octx.drawImage(this.scene, 0, 0);
      this.octx.globalCompositeOperation = 'source-over';
      if (p.overlay) p.overlay(v, audio, this.octx);
    }

    loop(ts) {
      if (!this.active) return;
      const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 1 / 60;
      this.last = ts;
      this.render(ts, dt);
      requestAnimationFrame(this.loop);
    }

    // Tests and snapshots (offscreen windows don't run requestAnimationFrame): step n frames
    step(n = 60) {
      let ts = this.t0 || performance.now();
      for (let i = 0; i < n; i++) { ts += 1000 / 60; this.render(ts, 1 / 60); }
    }
  };
})(window.FC);
