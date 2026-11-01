// LED screen: the 64×32 panel as round / square / sharp LEDs with an optional glow.
// Draws the raw frame from GET /api/display/frame.

window.FC = window.FC || {};

FC.LedScreen = class {
  constructor(root) {
    this.root = root;
    this.leds = root.querySelector('#leds');
    this.glow = root.querySelector('#glow');
    this.ctx = this.leds.getContext('2d');
    this.gctx = this.glow.getContext('2d');
    this.scratch = new OffscreenCanvas(64, 32);       // 1 px per LED, for the "sharp" style
    this.sctx = this.scratch.getContext('2d');
    this.prefs = { led_style: 'round', glow: true };
    this.last = null;
    this.brightness = 100;
  }

  show(on) {
    this.leds.style.display = this.glow.style.display = on ? '' : 'none';
    this.active = on;
    if (on) this.applyPrefs(this.prefs);
  }

  applyPrefs(p) {
    this.prefs = { ...this.prefs, ...p };
    if (this.active) this.glow.style.display = this.prefs.glow && this.prefs.led_style !== 'sharp' ? '' : 'none';
    this.resize();
  }

  resize() {
    if (!this.active) return;
    const r = this.leds.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    for (const c of [this.leds, this.glow]) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    this.root.style.setProperty('--glow', (Math.min(r.width, r.height * 2) / 64 * 0.55).toFixed(1) + 'px');
    if (this.last) this.draw(this.last, this.brightness);
  }

  draw(px, brightness) {
    this.last = px;
    this.brightness = brightness;
    if (!this.active) return;
    const W = 64, H = 32, ctx = this.ctx;
    const cw = this.leds.width, ch = this.leds.height;
    // Largest 2:1 area, centred: bezel padding and full screen never stretch the LEDs
    const aw = Math.min(cw, ch * 2), ah = aw / 2, ox = (cw - aw) / 2, oy = (ch - ah) / 2;
    // LED brightness 0–100 → never fully dark on screen, so a dimmed panel is still readable
    const k = 0.3 + 0.7 * Math.max(0, Math.min(100, brightness)) / 100;
    ctx.clearRect(0, 0, cw, ch);

    if (this.prefs.led_style === 'sharp') {
      const img = this.sctx.createImageData(W, H);
      for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
        img.data[j] = px[i] * k; img.data[j + 1] = px[i + 1] * k; img.data[j + 2] = px[i + 2] * k; img.data[j + 3] = 255;
      }
      this.sctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.scratch, ox, oy, aw, ah);
    } else {
      const sx = aw / W, sy = ah / H, round = this.prefs.led_style === 'round';
      const rad = Math.min(sx, sy) * 0.42, size = Math.min(sx, sy) * 0.84;
      // Unlit LEDs first, in one path, so the grid is visible like on the real panel
      ctx.fillStyle = '#151517';
      ctx.beginPath();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (px[i] | px[i + 1] | px[i + 2]) continue;
        const cx = ox + (x + 0.5) * sx, cy = oy + (y + 0.5) * sy;
        if (round) { ctx.moveTo(cx + rad, cy); ctx.arc(cx, cy, rad, 0, 6.2832); }
        else ctx.rect(cx - size / 2, cy - size / 2, size, size);
      }
      ctx.fill();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3, r = px[i], g = px[i + 1], b = px[i + 2];
        if (!(r | g | b)) continue;
        ctx.fillStyle = `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`;
        const cx = ox + (x + 0.5) * sx, cy = oy + (y + 0.5) * sy;
        ctx.beginPath();
        if (round) ctx.arc(cx, cy, rad, 0, 6.2832); else ctx.rect(cx - size / 2, cy - size / 2, size, size);
        ctx.fill();
      }
    }
    if (this.glow.style.display !== 'none') {
      this.gctx.clearRect(0, 0, cw, ch);
      this.gctx.drawImage(this.leds, 0, 0);
    }
  }
};
