/* Starship Dodger — physics-based asteroid dodging.
   No dependencies. Everything is drawn procedurally on a 2D canvas. */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", () => { resize(); if (state === "menu") buildBackground(); });
  resize();

  const $ = id => document.getElementById(id);
  const ui = {
    overlay: $("overlay"),
    start: $("startPanel"),
    over: $("gameOverPanel"),
    pause: $("pausePanel"),
    startBtn: $("startBtn"),
    restartBtn: $("restartBtn"),
    saveBtn: $("saveBtn"),
    nameEntry: $("nameEntry"),
    nameInput: $("nameInput"),
    finalScore: $("finalScore"),
    startBoard: $("startBoard"),
    endBoard: $("endBoard"),
  };

  // ---------------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------------
  const CFG = {
    ship: {
      thrust: 1100,        // px/s^2 lateral
      thrustY: 800,        // px/s^2 vertical
      maxSpeed: 560,       // px/s soft cap
      rcsDamping: 0.55,    // fraction of velocity bled per second by auto-stabilizer
      brakeDamping: 4.5,   // damping while braking
      bounce: 0.35,        // restitution against screen edges
      minYFrac: 0.42,      // ship may fly up to this fraction of screen height
      maxYFrac: 0.93,
      hull: 3,
      invulnTime: 2.0,
    },
    scroll: { base: 180, perLevel: 30, max: 560 },  // px/s downward flow of the field
    spawn:  { base: 0.9, perLevel: 0.1, min: 0.18 },   // seconds between spawns
    levelTime: 10,        // seconds per difficulty level (level 7 ≈ one minute in)
    nearMissDist: 34,     // px gap that counts as a near miss
    nearMissScore: 150,
    distanceScore: 0.06,  // points per px scrolled
  };

  // Rock tiers. Weight rises with level via `minLevel` and `weightPerLevel`.
  const TIERS = [
    { name: "pebble",   rMin: 7,  rMax: 13,  weight: 3.0, minLevel: 0, weightPerLevel: -0.15, mass: 1,  hue: [200, 8, 55] },
    { name: "rock",     rMin: 14, rMax: 26,  weight: 3.0, minLevel: 0, weightPerLevel: 0.0,   mass: 3,  hue: [30, 12, 42] },
    { name: "asteroid", rMin: 30, rMax: 52,  weight: 1.0, minLevel: 1, weightPerLevel: 0.35,  mass: 9,  hue: [22, 18, 36] },
    { name: "giant",    rMin: 62, rMax: 100, weight: 0.0, minLevel: 3, weightPerLevel: 0.28,  mass: 30, hue: [15, 14, 30] },
  ];

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const rnd11 = () => Math.random() * 2 - 1;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  // Deterministic PRNG so a rock's shape is stable per seed (mulberry32)
  function prng(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------------
  // Geometry: exact polygon vs polygon intersection
  // ---------------------------------------------------------------------------
  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segsIntersect(a, b, c, d) {
    const o = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }
  function polysIntersect(A, B) {
    for (const p of A) if (pointInPoly(p.x, p.y, B)) return true;
    for (const p of B) if (pointInPoly(p.x, p.y, A)) return true;
    for (let i = 0; i < A.length; i++) {
      const a = A[i], b = A[(i + 1) % A.length];
      for (let j = 0; j < B.length; j++) {
        if (segsIntersect(a, b, B[j], B[(j + 1) % B.length])) return true;
      }
    }
    return false;
  }
  // Distance from point to polygon edge (for near-miss detection)
  function pointPolyDist(px, py, poly) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      const ex = a.x + t * dx - px, ey = a.y + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let state = "menu";   // menu | playing | paused | dying | gameover
  let elapsed = 0, level = 0, score = 0, distance = 0;
  let spawnTimer = 0, fieldTimer = 0, fieldBurst = 0;
  let shake = 0, flash = 0, deathTimer = 0;

  const rocks = [], particles = [], popups = [];
  const stars = [[], [], []];   // three parallax layers
  const planets = [];
  const nebulae = [];

  const ship = {
    x: 0, y: 0, vx: 0, vy: 0,
    w: 34, h: 52,
    hull: 3, invuln: 0, bank: 0,
    thrustingL: false, thrustingR: false, thrustingU: false, thrustingD: false, braking: false,
    poly: [],
  };

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const keys = new Set();
  window.addEventListener("keydown", e => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "KeyP" || e.code === "Escape") togglePause();
    if ((e.code === "Enter" || e.code === "Space") && state === "menu") startGame();
    if ((e.code === "Enter" || e.code === "Space") && state === "gameover" && ui.nameEntry.classList.contains("hidden")) startGame();
  });
  window.addEventListener("keyup", e => keys.delete(e.code));
  window.addEventListener("blur", () => { keys.clear(); if (state === "playing") togglePause(); });

  // Touch: hold left/right half = lateral thrust, both = brake, upper third = forward thrust
  const touches = new Map();
  canvas.addEventListener("touchstart", e => { for (const t of e.changedTouches) touches.set(t.identifier, t); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", e => { for (const t of e.changedTouches) touches.set(t.identifier, t); e.preventDefault(); }, { passive: false });
  const endTouch = e => { for (const t of e.changedTouches) touches.delete(t.identifier); };
  canvas.addEventListener("touchend", endTouch);
  canvas.addEventListener("touchcancel", endTouch);

  function readInput() {
    let L = keys.has("ArrowLeft") || keys.has("KeyA");
    let R = keys.has("ArrowRight") || keys.has("KeyD");
    let U = keys.has("ArrowUp") || keys.has("KeyW");
    let D = keys.has("ArrowDown") || keys.has("KeyS");
    let B = keys.has("Space");
    let tl = false, tr = false, tu = false;
    for (const t of touches.values()) {
      if (t.clientX < W / 2) tl = true; else tr = true;
      if (t.clientY < H * 0.33) tu = true;
    }
    if (tl && tr) B = true; else { L = L || tl; R = R || tr; }
    U = U || tu;
    ship.thrustingL = L && !R; ship.thrustingR = R && !L;
    ship.thrustingU = U && !D; ship.thrustingD = D && !U;
    ship.braking = B;
  }

  ui.startBtn.addEventListener("click", startGame);
  ui.restartBtn.addEventListener("click", startGame);
  ui.saveBtn.addEventListener("click", saveScore);
  ui.nameInput.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") saveScore(); });

  // ---------------------------------------------------------------------------
  // Leaderboard (localStorage)
  // ---------------------------------------------------------------------------
  const LB_KEY = "starshipDodger.leaderboard.v2";
  function loadBoard() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch { return []; }
  }
  function storeBoard(b) { try { localStorage.setItem(LB_KEY, JSON.stringify(b)); } catch {} }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function renderBoard(el, highlightIdx = -1) {
    const b = loadBoard();
    if (!b.length) { el.innerHTML = '<h3>LEADERBOARD</h3><div class="empty">No flights logged yet.</div>'; return; }
    el.innerHTML = "<h3>LEADERBOARD</h3><ol>" + b.map((e, i) =>
      `<li class="${i === highlightIdx ? "you" : ""}"><span>${escapeHtml(e.name)}</span><span>${e.score}</span><span style="color:#6c7d97;margin-left:10px;width:34px;text-align:right">L${e.level}</span></li>`
    ).join("") + "</ol>";
  }
  function qualifies(s) { const b = loadBoard(); return s > 0 && (b.length < 10 || s > b[b.length - 1].score); }
  function saveScore() {
    const name = (ui.nameInput.value.trim() || "PILOT").toUpperCase().slice(0, 12);
    const b = loadBoard();
    const entry = { name, score: Math.floor(score), level: level + 1, date: Date.now() };
    b.push(entry); b.sort((a, c) => c.score - a.score); b.length = Math.min(b.length, 10);
    storeBoard(b);
    ui.nameEntry.classList.add("hidden");
    renderBoard(ui.endBoard, b.indexOf(entry));
  }

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------
  function buildBackground() {
    const counts = [90, 60, 30];
    for (let l = 0; l < 3; l++) {
      stars[l].length = 0;
      for (let i = 0; i < counts[l]; i++) {
        stars[l].push({ x: Math.random() * W, y: Math.random() * H, r: 0.5 + l * 0.55 + Math.random() * 0.6, tw: Math.random() * Math.PI * 2 });
      }
    }
    nebulae.length = 0;
    for (let i = 0; i < 3; i++) {
      nebulae.push({ x: Math.random() * W, y: Math.random() * H, r: rand(220, 420), hue: [215, 275, 335][i], a: rand(0.05, 0.1) });
    }
    planets.length = 0;
    for (let i = 0; i < 2; i++) planets.push(makePlanet(Math.random() * H));
  }
  function makePlanet(y) {
    const r = rand(26, 70);
    let x = rand(r, W - r);
    for (let i = 0; i < 6; i++) {
      if (planets.every(p => !p || Math.abs(p.x - x) > p.r + r + 40)) break;
      x = rand(r, W - r);
    }
    return { x, y, r, hue: Math.random() * 360, ring: Math.random() < 0.4, bands: Math.random() < 0.5, seed: Math.random() * 1000 };
  }

  function updateBackground(dt, scroll) {
    const rates = [0.06, 0.14, 0.28];
    for (let l = 0; l < 3; l++) {
      for (const s of stars[l]) {
        s.y += scroll * rates[l] * dt;
        if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
      }
    }
    for (const n of nebulae) {
      n.y += scroll * 0.03 * dt;
      if (n.y - n.r > H) { n.y = -n.r; n.x = Math.random() * W; }
    }
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      p.y += scroll * 0.09 * dt;
      if (p.y - p.r * 1.6 > H) planets[i] = makePlanet(-rand(80, 400));
    }
  }

  function drawBackground(t) {
    ctx.fillStyle = "#04060d";
    ctx.fillRect(0, 0, W, H);
    for (const n of nebulae) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      g.addColorStop(0, `hsla(${n.hue},70%,55%,${n.a})`);
      g.addColorStop(1, "hsla(0,0%,0%,0)");
      ctx.fillStyle = g;
      ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }
    const alphas = [0.45, 0.7, 1];
    for (let l = 0; l < 3; l++) {
      for (const s of stars[l]) {
        const tw = 0.7 + 0.3 * Math.sin(t * 2 + s.tw);
        ctx.globalAlpha = alphas[l] * tw;
        ctx.fillStyle = l === 2 ? "#dfe9ff" : "#b9c8e6";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const p of planets) drawPlanet(p);
  }

  function drawPlanet(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.ring) {
      ctx.strokeStyle = `hsla(${p.hue + 40},40%,75%,0.55)`;
      ctx.lineWidth = p.r * 0.18;
      ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.8, p.r * 0.45, -0.35, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
    }
    const g = ctx.createRadialGradient(-p.r * 0.4, -p.r * 0.4, p.r * 0.1, 0, 0, p.r);
    g.addColorStop(0, `hsl(${p.hue},55%,68%)`);
    g.addColorStop(0.7, `hsl(${p.hue},50%,38%)`);
    g.addColorStop(1, `hsl(${p.hue},45%,12%)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
    if (p.bands) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#000";
      for (let i = -3; i <= 3; i++) ctx.fillRect(-p.r, i * p.r * 0.3 + Math.sin(p.seed + i) * 4, p.r * 2, p.r * 0.1);
      ctx.restore();
    }
    if (p.ring) {
      ctx.strokeStyle = `hsla(${p.hue + 40},40%,75%,0.8)`;
      ctx.lineWidth = p.r * 0.18;
      ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.8, p.r * 0.45, -0.35, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Rocks
  // ---------------------------------------------------------------------------
  function pickTier() {
    const weights = TIERS.map(t => level < t.minLevel ? 0 : Math.max(0.05, t.weight + t.weightPerLevel * level));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < TIERS.length; i++) { r -= weights[i]; if (r <= 0) return TIERS[i]; }
    return TIERS[1];
  }

  function makeRock(tier, x, y, radius, vx, vy) {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const rnd = prng(seed);
    const n = 9 + Math.floor(rnd() * 6) + Math.floor(radius / 20);
    const verts = [];
    // Irregular outline: base radius perturbed with low-frequency lumps + high-frequency jaggedness
    const lumps = [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2];
    const amp = [0.12 + rnd() * 0.1, 0.06 + rnd() * 0.06, 0.03 + rnd() * 0.03];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let f = 1 + amp[0] * Math.sin(a * 2 + lumps[0]) + amp[1] * Math.sin(a * 3 + lumps[1]) + amp[2] * Math.sin(a * 5 + lumps[2]);
      f += (rnd() - 0.5) * 0.14;
      verts.push({ x: Math.cos(a) * radius * f, y: Math.sin(a) * radius * f });
    }
    const craters = [];
    const nc = Math.floor(radius / 9) + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < nc; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * radius * 0.6;
      craters.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: radius * (0.08 + rnd() * 0.14) });
    }
    const [h, s, l] = tier.hue;
    const mass = tier.mass * (radius / tier.rMin);
    return {
      tier, x, y, vx, vy, r: radius, mass,
      rot: rnd() * Math.PI * 2, spin: (rnd() - 0.5) * (radius > 40 ? 0.9 : 1.8),
      verts, craters, world: verts.map(() => ({ x: 0, y: 0 })),
      hue: h + (rnd() - 0.5) * 20, sat: s + rnd() * 8, lum: l + (rnd() - 0.5) * 10,
      passed: false, nearMissAwarded: false, minGap: Infinity,
    };
  }

  function spawnRock(burst = false) {
    const tier = pickTier();
    const r = rand(tier.rMin, tier.rMax);
    const speedFactor = burst ? rand(0.9, 1.15) : rand(0.75, 1.25);
    const scroll = scrollSpeed();
    const vy = scroll * speedFactor * (tier === TIERS[0] ? 1.15 : tier === TIERS[3] ? 0.75 : 1);
    const vx = rand(-1, 1) * (20 + level * 6) * (tier === TIERS[0] ? 1.5 : 1);
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = rand(r, W - r), y = -r - rand(0, 40);
      let ok = true;
      for (const o of rocks) {
        const dx = o.x - x, dy = o.y - y;
        if (dx * dx + dy * dy < (o.r + r + 6) ** 2) { ok = false; break; }
      }
      if (ok) { rocks.push(makeRock(tier, x, y, r, vx, vy)); return; }
    }
  }

  function updateRockPolys(rock) {
    const c = Math.cos(rock.rot), s = Math.sin(rock.rot);
    for (let i = 0; i < rock.verts.length; i++) {
      const v = rock.verts[i];
      rock.world[i].x = rock.x + v.x * c - v.y * s;
      rock.world[i].y = rock.y + v.x * s + v.y * c;
    }
  }

  function updateRocks(dt) {
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt;
      if (r.x < r.r * 0.5 && r.vx < 0) r.vx = -r.vx * 0.8;
      if (r.x > W - r.r * 0.5 && r.vx > 0) r.vx = -r.vx * 0.8;
      if (r.y - r.r > H + 40) { rocks.splice(i, 1); continue; }
      updateRockPolys(r);
    }
    // Rock-on-rock elastic collisions (circle approximation, keeps the field feeling physical)
    for (let i = 0; i < rocks.length; i++) {
      const a = rocks[i];
      for (let j = i + 1; j < rocks.length; j++) {
        const b = rocks[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const rr = (a.r + b.r) * 0.86;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn > 0) continue;
        const e = 0.6;
        const jImp = (-(1 + e) * vn) / (1 / a.mass + 1 / b.mass);
        a.vx -= (jImp / a.mass) * nx; a.vy -= (jImp / a.mass) * ny;
        b.vx += (jImp / b.mass) * nx; b.vy += (jImp / b.mass) * ny;
        const pen = rr - d, tot = a.mass + b.mass;
        a.x -= nx * pen * (b.mass / tot); a.y -= ny * pen * (b.mass / tot);
        b.x += nx * pen * (a.mass / tot); b.y += ny * pen * (a.mass / tot);
        a.spin += rnd11() * 0.4; b.spin += rnd11() * 0.4;
        if (a.r + b.r > 60) spawnDust((a.x + b.x) / 2, (a.y + b.y) / 2, 4, a);
      }
    }
  }

  function drawRock(r) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.rot);
    // body with directional light (from top-left of screen; counter-rotate so the light stays fixed)
    const la = -r.rot - Math.PI * 0.75;
    const lx = Math.cos(la) * r.r * 0.6, ly = Math.sin(la) * r.r * 0.6;
    const g = ctx.createRadialGradient(lx, ly, r.r * 0.05, 0, 0, r.r * 1.15);
    g.addColorStop(0, `hsl(${r.hue},${r.sat}%,${r.lum + 22}%)`);
    g.addColorStop(0.55, `hsl(${r.hue},${r.sat}%,${r.lum}%)`);
    g.addColorStop(1, `hsl(${r.hue},${r.sat}%,${Math.max(4, r.lum - 22)}%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(r.verts[0].x, r.verts[0].y);
    for (let i = 1; i < r.verts.length; i++) ctx.lineTo(r.verts[i].x, r.verts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(1, r.r * 0.05);
    ctx.strokeStyle = `hsl(${r.hue},${r.sat}%,${Math.max(3, r.lum - 26)}%)`;
    ctx.stroke();
    // craters: dark bowl with a lit rim on the side facing the light
    ctx.save();
    ctx.clip();
    for (const c of r.craters) {
      ctx.fillStyle = `hsla(${r.hue},${r.sat}%,${Math.max(2, r.lum - 16)}%,0.6)`;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `hsla(${r.hue},${r.sat}%,${r.lum + 18}%,0.55)`;
      ctx.lineWidth = Math.max(0.8, c.r * 0.22);
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.9, la + Math.PI * 0.6, la + Math.PI * 1.4); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Ship
  // ---------------------------------------------------------------------------
  function resetShip() {
    ship.x = W / 2; ship.y = H * 0.82; ship.vx = 0; ship.vy = 0;
    ship.hull = CFG.ship.hull; ship.invuln = 0; ship.bank = 0;
  }

  function updateShip(dt) {
    const c = CFG.ship;
    let ax = 0, ay = 0;
    if (ship.thrustingL) ax -= c.thrust;
    if (ship.thrustingR) ax += c.thrust;
    if (ship.thrustingU) ay -= c.thrustY;
    if (ship.thrustingD) ay += c.thrustY;
    ship.vx += ax * dt; ship.vy += ay * dt;

    // RCS auto-stabilizer: gentle exponential damping so the ship is controllable, plus a hard brake
    const damp = ship.braking ? c.brakeDamping : c.rcsDamping;
    const k = Math.exp(-damp * dt);
    ship.vx *= k; ship.vy *= k;

    // Soft speed cap
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > c.maxSpeed) { const f = lerp(1, c.maxSpeed / sp, clamp(dt * 6, 0, 1)); ship.vx *= f; ship.vy *= f; }

    ship.x += ship.vx * dt; ship.y += ship.vy * dt;

    // Edges: bounce, lose some energy
    const hw = ship.w / 2;
    if (ship.x < hw) { ship.x = hw; ship.vx = Math.abs(ship.vx) * c.bounce; }
    if (ship.x > W - hw) { ship.x = W - hw; ship.vx = -Math.abs(ship.vx) * c.bounce; }
    const yMin = H * c.minYFrac, yMax = H * c.maxYFrac - ship.h / 2;
    if (ship.y < yMin) { ship.y = yMin; ship.vy = Math.abs(ship.vy) * c.bounce; }
    if (ship.y > yMax) { ship.y = yMax; ship.vy = -Math.abs(ship.vy) * c.bounce; }

    // Visual bank angle follows lateral velocity
    const targetBank = clamp(ship.vx / c.maxSpeed, -1, 1) * 0.42;
    ship.bank += (targetBank - ship.bank) * clamp(dt * 8, 0, 1);
    if (ship.invuln > 0) ship.invuln -= dt;

    // Hit polygon in world space (ship is centered at ship.x, ship.y)
    const cs = Math.cos(ship.bank), sn = Math.sin(ship.bank);
    const local = [
      { x: 0, y: -ship.h / 2 },
      { x: ship.w * 0.32, y: ship.h * 0.15 },
      { x: ship.w / 2, y: ship.h / 2 - 4 },
      { x: -ship.w / 2, y: ship.h / 2 - 4 },
      { x: -ship.w * 0.32, y: ship.h * 0.15 },
    ];
    ship.poly = local.map(p => ({ x: ship.x + p.x * cs - p.y * sn, y: ship.y + p.x * sn + p.y * cs }));

    // Thruster exhaust particles
    const burning = ship.thrustingL || ship.thrustingR || ship.thrustingU;
    if (burning && Math.random() < 0.8) {
      const dirx = (ship.thrustingL ? 1 : ship.thrustingR ? -1 : 0);
      const px = ship.x + dirx * ship.w * 0.5, py = ship.y + (ship.thrustingU ? ship.h / 2 : ship.h * 0.15);
      particles.push({ x: px, y: py, vx: dirx * rand(120, 220) + ship.vx * 0.5 + rnd11() * 30, vy: (ship.thrustingU ? rand(160, 260) : rand(60, 120)) + rnd11() * 30, life: rand(0.15, 0.35), age: 0, r: rand(1.5, 3), col: "flame" });
    }
  }

  function drawShip(t) {
    if (ship.invuln > 0 && Math.floor(t * 14) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.bank);
    const w = ship.w, h = ship.h;
    // main engine flame
    if (ship.thrustingU || ship.thrustingL || ship.thrustingR) {
      const fl = ship.thrustingU ? rand(22, 34) : rand(10, 16);
      const g = ctx.createLinearGradient(0, h / 2 - 4, 0, h / 2 + fl);
      g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.3, "rgba(120,210,255,0.9)"); g.addColorStop(1, "rgba(60,120,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-w * 0.18, h / 2 - 4); ctx.lineTo(0, h / 2 + fl); ctx.lineTo(w * 0.18, h / 2 - 4); ctx.closePath(); ctx.fill();
    }
    // side thruster puffs
    const puff = (dir) => {
      ctx.fillStyle = "rgba(150,220,255,0.85)";
      ctx.beginPath(); ctx.moveTo(dir * w * 0.5, h * 0.12); ctx.lineTo(dir * (w * 0.5 + rand(8, 14)), h * 0.18); ctx.lineTo(dir * w * 0.5, h * 0.24); ctx.closePath(); ctx.fill();
    };
    if (ship.thrustingL) puff(1);
    if (ship.thrustingR) puff(-1);
    if (ship.thrustingD || ship.braking) {
      ctx.fillStyle = "rgba(255,200,120,0.8)";
      ctx.beginPath(); ctx.moveTo(-w * 0.22, -h * 0.25); ctx.lineTo(-w * 0.3, -h * 0.25 - rand(8, 12)); ctx.lineTo(-w * 0.12, -h * 0.2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(w * 0.22, -h * 0.25); ctx.lineTo(w * 0.3, -h * 0.25 - rand(8, 12)); ctx.lineTo(w * 0.12, -h * 0.2); ctx.closePath(); ctx.fill();
    }
    // wings
    ctx.fillStyle = "#3a6f8f";
    ctx.beginPath(); ctx.moveTo(0, -h * 0.05); ctx.lineTo(w / 2, h / 2 - 4); ctx.lineTo(w * 0.36, h / 2); ctx.lineTo(0, h * 0.3); ctx.lineTo(-w * 0.36, h / 2); ctx.lineTo(-w / 2, h / 2 - 4); ctx.closePath(); ctx.fill();
    // fuselage
    const g2 = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
    g2.addColorStop(0, "#9fd8ea"); g2.addColorStop(0.5, "#e8fbff"); g2.addColorStop(1, "#7fb6cc");
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.quadraticCurveTo(w * 0.3, -h * 0.1, w * 0.22, h / 2 - 6); ctx.lineTo(-w * 0.22, h / 2 - 6); ctx.quadraticCurveTo(-w * 0.3, -h * 0.1, 0, -h / 2); ctx.closePath(); ctx.fill();
    // cockpit
    ctx.fillStyle = "#12324a";
    ctx.beginPath(); ctx.ellipse(0, -h * 0.18, w * 0.11, h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.ellipse(-w * 0.03, -h * 0.23, w * 0.04, h * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    // engine nozzle
    ctx.fillStyle = "#1e2a36";
    ctx.fillRect(-w * 0.2, h / 2 - 7, w * 0.4, 5);
    ctx.restore();
    ctx.globalAlpha = 1;
    // shield ring while invulnerable
    if (ship.invuln > 0) {
      ctx.strokeStyle = `rgba(94,225,255,${0.25 + 0.25 * Math.sin(t * 20)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ship.x, ship.y, ship.h * 0.62, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Particles & popups
  // ---------------------------------------------------------------------------
  function spawnDust(x, y, n, rock) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: rnd11() * 60, vy: rnd11() * 60 + (rock ? rock.vy * 0.5 : 0), life: rand(0.3, 0.7), age: 0, r: rand(1, 2.5), col: "dust", hue: rock ? rock.hue : 30, rot: 0, spin: 0 });
  }
  function explodeRock(rock, strength = 1) {
    const n = Math.floor(rock.r * 0.9 * strength) + 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(40, 260) * strength;
      particles.push({ x: rock.x, y: rock.y, vx: Math.cos(a) * sp + rock.vx * 0.3, vy: Math.sin(a) * sp + rock.vy * 0.3, life: rand(0.5, 1.4), age: 0, r: rand(1.5, Math.max(2, rock.r * 0.12)), col: "dust", hue: rock.hue, spin: rnd11() * 6, rot: Math.random() * 6 });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(80, 320);
      particles.push({ x: rock.x, y: rock.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), age: 0, r: rand(2, 4), col: "flame" });
    }
  }
  function explodeShip() {
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(30, 380);
      particles.push({ x: ship.x, y: ship.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.5, 1.8), age: 0, r: rand(1.5, 4), col: i % 3 === 0 ? "flame" : "hull" });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.spin) p.rot += p.spin * dt;
      p.vx *= 0.985; p.vy *= 0.985;
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const k = 1 - p.age / p.life;
      if (p.col === "flame") {
        ctx.fillStyle = `rgba(${lerp(255, 120, 1 - k) | 0},${lerp(240, 90, 1 - k) | 0},${lerp(200, 255, 1 - k) | 0},${k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + k), 0, Math.PI * 2); ctx.fill();
      } else if (p.col === "dust") {
        ctx.fillStyle = `hsla(${p.hue},14%,${35 + 20 * k}%,${k})`;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillRect(-p.r, -p.r * 0.7, p.r * 2, p.r * 1.4);
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(160,220,240,${k})`;
        ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      }
    }
  }
  function popup(x, y, text, color = "#5ee1ff") { popups.push({ x, y, text, color, age: 0, life: 1.1 }); }
  function updatePopups(dt) {
    for (let i = popups.length - 1; i >= 0; i--) { const p = popups[i]; p.age += dt; p.y -= 40 * dt; if (p.age > p.life) popups.splice(i, 1); }
  }
  function drawPopups() {
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "bold 16px Segoe UI, Arial";
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  const scrollSpeed = () => Math.min(CFG.scroll.max, CFG.scroll.base + CFG.scroll.perLevel * level);
  const spawnInterval = () => Math.max(CFG.spawn.min, CFG.spawn.base - CFG.spawn.perLevel * level);

  function startGame() {
    elapsed = 0; level = 0; score = 0; distance = 0;
    spawnTimer = 0.6; fieldTimer = rand(8, 14); fieldBurst = 0;
    shake = 0; flash = 0; deathTimer = 0;
    rocks.length = 0; particles.length = 0; popups.length = 0;
    buildBackground();
    resetShip();
    keys.clear();
    ui.overlay.classList.add("hidden");
    ui.start.classList.add("hidden"); ui.over.classList.add("hidden"); ui.pause.classList.add("hidden");
    state = "playing";
    last = performance.now(); acc = 0;
  }

  function togglePause() {
    if (state === "playing") { state = "paused"; ui.overlay.classList.remove("hidden"); ui.pause.classList.remove("hidden"); }
    else if (state === "paused") { state = "playing"; ui.overlay.classList.add("hidden"); ui.pause.classList.add("hidden"); last = performance.now(); acc = 0; }
  }

  function hitShip(rock) {
    explodeRock(rock, 1.2);
    rocks.splice(rocks.indexOf(rock), 1);
    ship.hull -= 1;
    shake = 14; flash = 0.35;
    // impulse from the rock
    ship.vx += rock.vx * 0.6 + (ship.x - rock.x) * 3;
    ship.vy += rock.vy * 0.3;
    if (ship.hull <= 0) {
      explodeShip();
      state = "dying"; deathTimer = 1.6; shake = 26;
    } else {
      ship.invuln = CFG.ship.invulnTime;
      popup(ship.x, ship.y - 50, "HULL -1", "#ff5d5d");
    }
  }

  function endGame() {
    state = "gameover";
    const s = Math.floor(score);
    ui.finalScore.innerHTML = `Score <strong>${s}</strong> &nbsp;&middot;&nbsp; Level ${level + 1} &nbsp;&middot;&nbsp; ${Math.round(distance / 100)} km`;
    ui.overlay.classList.remove("hidden");
    ui.over.classList.remove("hidden");
    if (qualifies(s)) {
      ui.nameEntry.classList.remove("hidden");
      ui.nameInput.value = "";
      renderBoard(ui.endBoard);
      setTimeout(() => ui.nameInput.focus(), 50);
    } else {
      ui.nameEntry.classList.add("hidden");
      renderBoard(ui.endBoard);
    }
  }

  function update(dt) {
    const scroll = scrollSpeed();
    updateBackground(dt, scroll);
    updateParticles(dt);
    updatePopups(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (flash > 0) flash = Math.max(0, flash - dt);

    if (state === "dying") {
      deathTimer -= dt;
      updateRocks(dt);
      if (deathTimer <= 0) endGame();
      return;
    }
    if (state !== "playing") return;

    elapsed += dt;
    const newLevel = Math.floor(elapsed / CFG.levelTime);
    if (newLevel !== level) { level = newLevel; popup(W / 2, H * 0.3, `LEVEL ${level + 1}`, "#ffd166"); }
    distance += scroll * dt;
    score += scroll * dt * CFG.distanceScore;

    readInput();
    updateShip(dt);

    // Spawning: steady stream plus occasional dense fields
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnRock();
      spawnTimer = spawnInterval() * rand(0.7, 1.3);
    }
    fieldTimer -= dt;
    if (fieldTimer <= 0 && fieldBurst === 0) {
      fieldBurst = 8 + level * 3;
      popup(W / 2, H * 0.25, "ASTEROID FIELD", "#ff9f5e");
      fieldTimer = rand(12, 20);
    }
    if (fieldBurst > 0 && Math.random() < dt * 10) { spawnRock(true); fieldBurst--; }

    updateRocks(dt);

    // Collisions and near misses
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      const dx = r.x - ship.x, dy = r.y - ship.y;
      const reach = r.r + ship.h;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (ship.invuln <= 0 && polysIntersect(ship.poly, r.world)) { hitShip(r); continue; }
      // Track closest approach for near-miss bonus
      let gap = Infinity;
      for (const p of ship.poly) gap = Math.min(gap, pointPolyDist(p.x, p.y, r.world));
      if (gap < r.minGap) r.minGap = gap;
      if (!r.nearMissAwarded && r.y > ship.y && r.minGap < CFG.nearMissDist && ship.invuln <= 0) {
        r.nearMissAwarded = true;
        const bonus = Math.round(CFG.nearMissScore * (1 + r.r / 40) * (1 - r.minGap / CFG.nearMissDist * 0.5));
        score += bonus;
        popup(ship.x, ship.y - 46, `NEAR MISS +${bonus}`, "#ffd166");
        spawnDust(ship.x + (r.x > ship.x ? ship.w / 2 : -ship.w / 2), ship.y, 5, r);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  function drawHUD() {
    ctx.save();
    ctx.font = "bold 20px Segoe UI, Arial";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillStyle = "#e8f1ff";
    ctx.fillText(`SCORE ${Math.floor(score)}`, 18, 14);
    ctx.font = "13px Segoe UI, Arial";
    ctx.fillStyle = "#8a9bb5";
    ctx.fillText(`LEVEL ${level + 1}   ${Math.round(distance / 100)} km`, 18, 40);
    // hull pips
    for (let i = 0; i < CFG.ship.hull; i++) {
      ctx.fillStyle = i < ship.hull ? "#5ee1ff" : "rgba(255,255,255,0.12)";
      ctx.beginPath(); ctx.moveTo(18 + i * 22, 74); ctx.lineTo(18 + i * 22 + 8, 62); ctx.lineTo(18 + i * 22 + 16, 74); ctx.lineTo(18 + i * 22 + 8, 70); ctx.closePath(); ctx.fill();
    }
    // velocity vector indicator (right side)
    const cx = W - 52, cy = 46, R = 26;
    ctx.strokeStyle = "rgba(138,155,181,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    const vx = clamp(ship.vx / CFG.ship.maxSpeed, -1, 1) * R, vy = clamp(ship.vy / CFG.ship.maxSpeed, -1, 1) * R;
    ctx.strokeStyle = "#5ee1ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + vx, cy + vy); ctx.stroke();
    ctx.fillStyle = "#5ee1ff"; ctx.beginPath(); ctx.arc(cx + vx, cy + vy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = "11px Segoe UI, Arial"; ctx.textAlign = "center"; ctx.fillStyle = "#8a9bb5";
    ctx.fillText(`${Math.round(Math.hypot(ship.vx, ship.vy))} m/s`, cx, cy + R + 6);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  // Fixed-timestep simulation: physics always advances in STEP-sized ticks, and catches up to
  // real time (up to MAX_CATCHUP per frame) so a throttled or slow tab does not slow the game down.
  const STEP = 1 / 120, MAX_CATCHUP = 0.25;
  let last = performance.now(), acc = 0;

  function menuTick(dt) {
    updateBackground(dt, 60);
    for (const r of rocks) { r.y += r.vy * dt; r.rot += r.spin * dt; updateRockPolys(r); }
    for (let i = rocks.length - 1; i >= 0; i--) if (rocks[i].y - rocks[i].r > H) rocks.splice(i, 1);
    if (rocks.length < 6 && Math.random() < dt * 0.6) {
      const tier = TIERS[1 + Math.floor(Math.random() * 2)];
      const rr = rand(tier.rMin, tier.rMax);
      rocks.push(makeRock(tier, rand(rr, W - rr), -rr, rr, rnd11() * 10, rand(40, 80)));
    }
  }

  function frame(now) {
    acc += Math.min((now - last) / 1000, MAX_CATCHUP);
    last = now;
    const t = now / 1000;

    if (state !== "paused") {
      while (acc >= STEP) {
        if (state === "menu") menuTick(STEP); else update(STEP);
        acc -= STEP;
      }
    } else acc = 0;

    ctx.save();
    if (shake > 0) ctx.translate(rnd11() * shake, rnd11() * shake);
    drawBackground(t);
    for (const r of rocks) drawRock(r);
    drawParticles();
    if (state === "playing" || state === "paused") drawShip(t);
    drawPopups();
    ctx.restore();
    if (flash > 0) { ctx.fillStyle = `rgba(255,80,60,${flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
    if (state !== "menu") drawHUD();

    requestAnimationFrame(frame);
  }

  buildBackground();
  renderBoard(ui.startBoard);
  requestAnimationFrame(frame);

  // Small debug hook (used for testing; harmless in production)
  window.__dodger = {
    get state() { return state; },
    get level() { return level; },
    get score() { return score; },
    get ship() { return ship; },
    get rocks() { return rocks; },
    setLevel(n) { level = n; elapsed = n * CFG.levelTime; },
    spawn(tierIdx, x, y) {
      const tier = TIERS[tierIdx]; const r = rand(tier.rMin, tier.rMax);
      rocks.push(makeRock(tier, x ?? W / 2, y ?? H * 0.3, r, 0, 0)); return rocks[rocks.length - 1];
    },
  };
})();
