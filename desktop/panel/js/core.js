// Panel window controller: applies the style prefs (screen + case), polls the
// app, and feeds the active screen.
//
//   LED screen        GET /api/display/frame  (raw 64×32 RGB, 10 fps)
//   flip / e-ink      GET /api/display/model  (plugin describe() data, 4 Hz) → layout → Board
//                     plus the frame when the board shows raw pixels (maze, unknown modules)
//
// Preview mode (the gallery): ?fixture=<n>&screen=…&case=…&color=… draws sample
// data from js/fixtures.js and never polls.

(function (FC) {
  const params = new URLSearchParams(location.search);
  const preview = params.has('fixture');
  const body = document.body;
  const screenEl = document.getElementById('screen');
  const offline = document.getElementById('offline');

  const screens = {
    led: new FC.LedScreen(screenEl),
    flipboard: new FC.FlipScreen(screenEl),
    eink: new FC.EinkScreen(screenEl),
  };

  let prefs = { screen: 'led', case: 'none', case_color: '', led_style: 'round', bezel: true, glow: true, flip_sound: false };
  let state = null;          // {plugin, model} from /api/display/model (or a fixture)
  let frame = null;          // latest raw pixels
  let brightness = 100;
  let lastBoard = '';

  const current = () => screens[prefs.screen] || screens.led;

  // Called by the app (evaluate_js) when settings change, and once at load
  window.applyPrefs = (p) => {
    prefs = { ...prefs, ...p };
    body.dataset.screen = prefs.screen;
    body.dataset.case = prefs.case;
    body.dataset.color = prefs.case_color || '';
    body.classList.toggle('bezel', !!prefs.bezel);
    for (const [name, s] of Object.entries(screens)) s.show(name === prefs.screen);
    for (const s of Object.values(screens)) s.applyPrefs(prefs);
    lastBoard = '';
    resize();
    relayout();
  };

  function resize() {
    body.classList.toggle('fs', window.innerWidth >= screen.width - 1 && window.innerHeight >= screen.height - 1);
    current().resize();
  }
  window.addEventListener('resize', resize);

  // ---- boards (flip / e-ink) ---------------------------------------------------------
  function relayout() {
    if (prefs.screen === 'led' || !state) return;
    const board = FC.buildBoard(state, Date.now());
    const sig = JSON.stringify(board);
    if (sig === lastBoard) return;
    lastBoard = sig;
    current().setBoard(board);
    current().lastBoardObj = board;
  }
  setInterval(relayout, 250);          // layouts page and tick on their own clock

  const wantsFrame = () => prefs.screen === 'led' || !!(current().lastBoardObj && current().lastBoardObj.pixels);

  function gotFrame(px, b) {
    frame = px;
    if (b !== brightness) {
      brightness = b;
      screens.eink.setBrightness(b);
      screenEl.style.setProperty('--dim', String(0.3 + 0.7 * b / 100));
    }
    if (!px) return;
    if (prefs.screen === 'led') screens.led.draw(px, b);
    else current().setFrame(px);
  }

  // ---- live polling ---------------------------------------------------------------
  function same(a, b) {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async function pollFrame() {
    const t0 = performance.now();
    if (wantsFrame()) {
      try {
        const r = await fetch('/api/display/frame', { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        const px = new Uint8Array(await r.arrayBuffer());
        const b = parseInt(r.headers.get('X-Brightness') || '100', 10);
        if (b !== brightness || !same(frame, px)) gotFrame(px, b);
        offline.style.display = 'none';
      } catch (e) {
        if (!frame) offline.style.display = 'flex';
      }
    }
    setTimeout(pollFrame, Math.max(0, 100 - (performance.now() - t0)));
  }

  // ---- Now Playing ⏮ ⏯ ⏭ ----------------------------------------------------------
  // Shown (on hover, see panel.css) only while Now Playing is up with a source that can skip
  const npMsg = document.getElementById('np-msg');
  let npMsgTimer = null;
  function npControls() {
    const on = !preview && !!state && state.plugin === 'now_playing' && !!(state.model && state.model.can_skip);
    body.classList.toggle('np-skip', on);
    body.classList.toggle('np-paused', on && !!state.model.paused);
    document.querySelector('.np-main').title = on && state.model.paused ? 'Play' : 'Pause';
  }
  function npSay(text) {
    npMsg.textContent = text;
    npMsg.classList.add('on');
    clearTimeout(npMsgTimer);
    npMsgTimer = setTimeout(() => npMsg.classList.remove('on'), 4000);
  }
  for (const btn of document.querySelectorAll('.np-btn')) {
    // Keep clicks off the window drag (Windows easy_drag listens for mousedown) and double-click full screen
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('dblclick', (e) => e.stopPropagation());
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.classList.contains('busy')) return;
      btn.classList.add('busy');
      try {
        const action = btn.dataset.action;
        const r = await fetch('/api/now_playing/control', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ action }) }).then((r) => r.json());
        if (!r.ok) npSay(r.error || "Couldn't control the music");
        else if (action === 'playpause') body.classList.toggle('np-paused');   // until the next poll confirms it
      } catch (err) {
        npSay("Couldn't control the music");
      }
      setTimeout(() => btn.classList.remove('busy'), 400);
    });
  }

  let lastRev = null, modelTicks = 0;
  async function pollModel() {
    const t0 = performance.now();
    // The LED screen only needs the model for the ⏮ ⏭ buttons, so it asks once a second
    modelTicks++;
    if (prefs.screen !== 'led' || modelTicks % 4 === 0) {
      try {
        const r = await fetch('/api/display/model', { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        const m = await r.json();
        if (m.rev !== lastRev) {
          lastRev = m.rev;
          state = { plugin: m.plugin, model: m.model };
          relayout();
          npControls();
        }
        if (m.brightness !== brightness) gotFrame(frame, m.brightness);
        offline.style.display = 'none';
      } catch (e) {
        if (!state) offline.style.display = 'flex';
      }
    }
    setTimeout(pollModel, Math.max(0, 250 - (performance.now() - t0)));
  }

  // ---- preview (gallery) ---------------------------------------------------------------
  // A stand-in frame for pixel boards: a little maze in LED colours
  function demoFrame() {
    const W = 64, H = 32, px = new Uint8Array(W * H * 3);
    const set = (x, y, c) => { const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (x % 4 === 0 || y % 4 === 0) if (!(rnd() < 0.42 && x % 4 && y % 4 === 0) && !(rnd() < 0.42 && y % 4 && x % 4 === 0)) set(x, y, [40, 90, 255]);
    for (let x = 2; x < 40; x++) set(x, 2, [255, 210, 0]);
    for (let y = 2; y < 22; y++) set(39, y, [255, 210, 0]);
    set(39, 22, [255, 60, 60]);
    return px;
  }

  // Context menu → native menu; double-click → full screen
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.pywebview) window.pywebview.api.context_menu();
  });
  document.addEventListener('dblclick', () => { if (window.pywebview) window.pywebview.api.toggle_fullscreen(); });

  if (preview) {
    const fx = FC.FIXTURES[Number(params.get('fixture'))] || FC.FIXTURES[0];
    state = { plugin: fx.plugin, model: fx.model };
    window.applyPrefs({
      screen: params.get('screen') || 'flipboard', case: params.get('case') || 'none',
      case_color: params.get('color') || '', led_style: params.get('led_style') || 'round',
      bezel: params.get('bezel') !== '0', glow: true,
    });
    gotFrame(demoFrame(), 100);
  } else {
    fetch('/api/desktop/settings').then((r) => r.json()).then(window.applyPrefs).catch(() => window.applyPrefs({}));
    pollFrame();
    pollModel();
  }
})(window.FC);
