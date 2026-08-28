/* ARTIFEX FIELD NOTES — shared scene library (loaded by every scene HTML).
   One place for the visual DNA: color tokens + typography + reusable component CSS, the animation
   helpers (win/S/P/eo/eio), the deterministic living-constellation background, and the Artifex mark.
   Scenes provide only their own DOM + a render(t) + a per-scene background intensity. This is the
   "content factory" substrate for #004+ — established after #001–#003. */
(function () {
  const CSS = `
:root{--ink0:#06080C;--ink1:#0C1220;--ink2:#101a2e;--chalk:#F6F8FC;--mute:#AEBBD0;--azure:#93B8FF;
 --teal:#7FE3C7;--amber:#F5B95C;--faint:#5A6B85;--card:#141c2b;--line:#26334a;--red:#e0655a;
 --cardhi:#182338;--cell:#0f1826;}
*{margin:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}
html,body{width:1080px;height:1920px;overflow:hidden}
body{background:radial-gradient(1200px 900px at 50% 22%,#12203a 0%,var(--ink1) 42%,var(--ink0) 100%);
 font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--chalk)}
.l{position:absolute;left:50%;top:0;transform:translateX(-50%);opacity:0;will-change:transform,opacity}
.center{width:960px;text-align:center;left:50%}
.eyebrow{font-size:24px;font-weight:600;letter-spacing:6px;color:var(--azure)}
.h1{font-size:76px;font-weight:800;line-height:1.05;letter-spacing:-1px}
.h2{font-size:60px;font-weight:800;line-height:1.08;letter-spacing:-.5px}
.h3{font-size:48px;font-weight:800;line-height:1.12;letter-spacing:-.3px}
.sub{font-size:38px;font-weight:500;color:var(--mute);line-height:1.3}
.tag{font-size:32px;font-weight:700;letter-spacing:4px;color:var(--faint)}
.chip{display:inline-flex;align-items:center;gap:14px;font-size:32px;font-weight:800;border-radius:14px;padding:14px 24px}
.chip.ok{color:var(--teal);border:1px solid #2b5f52;background:#10241f}
.chip.warn{color:var(--amber);border:1px solid #6b5326;background:#241d10}
.chip.cold{color:var(--faint);border:1px solid #2b374d;background:#121a28}
.chip.neutral{color:var(--chalk);border:1px solid var(--line);background:var(--card)}
.surface{width:800px;border-radius:24px;background:var(--card);border:1px solid var(--line);
 box-shadow:0 30px 80px rgba(0,0,0,.45);overflow:hidden}
.sbar{height:78px;background:var(--cell);display:flex;align-items:center;gap:18px;padding:0 32px;
 border-bottom:1px solid var(--line);font-size:29px;font-weight:800;letter-spacing:1px;color:var(--chalk)}
.sbar.teal{color:var(--teal)}.sbar .kind{margin-left:auto;font-size:22px;font-weight:800;letter-spacing:3px;color:var(--faint)}
.ic{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;
 font-size:26px;font-weight:800;background:linear-gradient(135deg,#2c5ac4,#7fe3c7);color:#fff}
.sbody{padding:28px 36px 32px}
.frow{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 4px;border-bottom:1px solid #1b2740}
.frow:last-child{border-bottom:none}
.fl{font-size:26px;color:var(--faint);font-weight:700;letter-spacing:1px}
.fv{font-size:34px;font-weight:800}
.pill{font-size:30px;font-weight:800;color:var(--chalk);background:var(--card);border:1px solid var(--line);
 border-radius:14px;padding:16px 26px;display:inline-block}
.pill.sys{border-color:#3a6fd0;color:var(--azure);background:#101d34}
.pill.ok{border-color:#2b5f52;color:var(--teal);background:#10241f}
.arw{color:var(--azure);font-size:40px;vertical-align:middle}
/* open→closed chain (the workflow-loop grammar) */
.cnode{display:inline-flex;align-items:center;justify-content:center;font-size:23px;font-weight:800;letter-spacing:1px;
 color:var(--chalk);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 17px;white-space:nowrap}
.cnode.on{border-color:#2b5f52;color:var(--teal);background:#10241f}
.cnode.gap{border-style:dashed;border-color:#43506a;color:var(--faint);background:transparent}
.cbar{display:inline-block;width:40px;height:3px;background:#33445f;vertical-align:middle;border-radius:2px}
.cbar.on{background:var(--teal)}
.cbar.gap{background:repeating-linear-gradient(90deg,#43506a 0 8px,transparent 8px 16px)}
.mark{width:70px;height:70px}
.meta{top:150px}
`;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

  window.MARK_SVG = `<svg class="mark" viewBox="0 0 32 32"><path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" fill="none" stroke="#F7F6F4" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="4" r="2.7" fill="#F7F6F4"/><circle cx="5" cy="27" r="2.5" fill="#F7F6F4"/><circle cx="27" cy="27" r="2.5" fill="#F5B95C"/></svg>`;

  // animation helpers (shared)
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const inv = (t, a, b) => clamp((t - a) / ((b - a) || 1e-6), 0, 1);
  const eo = x => 1 - Math.pow(1 - x, 3);
  const eio = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  function win(t, a, b, fi = .3, fo = .3) { if (t < a || t > b) return 0; return Math.min(eo(inv(t, a, a + fi)), eo(1 - inv(t, b - fo, b))); }
  function S(id, o, x = 0, y = 0, s = 1) { const e = document.getElementById(id); if (!e) return; e.style.opacity = o; e.style.transform = `translateX(-50%) translate(${x}px,${y}px) scale(${s})`; }
  function P(id, o, x, y, s = 1) { const e = document.getElementById(id); if (!e) return; e.style.opacity = o; e.style.transform = `translate(${x}px,${y}px) scale(${s})`; }
  Object.assign(window, { clamp, inv, eo, eio, win, S, P });

  // deterministic living constellation. makeBg(seed) → drawBg(t, gA). gA (0..1) = per-scene alpha
  // (activity × clarity) the scene computes so foreground always wins.
  window.makeBg = function (seed) {
    const bg = document.getElementById('bg'), x = bg.getContext('2d');
    const rng = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(seed);
    const layers = [{ n: 22, sp: 0.06, amp: 10, rad: 2.0, al: 0.05 }, { n: 18, sp: 0.12, amp: 14, rad: 2.6, al: 0.09 }, { n: 8, sp: 0.22, amp: 20, rad: 3.0, al: 0.13 }];
    const NODES = []; layers.forEach((L, z) => { for (let i = 0; i < L.n; i++) NODES.push({ bx: rng() * 1080, by: rng() * 1920, ph: rng() * 6.28, ph2: rng() * 6.28, sp: L.sp * (0.7 + rng() * 0.6), amp: L.amp, rad: L.rad, al: L.al, z }); });
    const CONN = []; const c = NODES.filter(n => n.z >= 1);
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) { const d = Math.hypot(c[i].bx - c[j].bx, c[i].by - c[j].by); if (d < 300) CONN.push({ a: c[i], b: c[j], cph: rng() * 6.28, pulse: rng() < 0.35, psp: 0.15 + rng() * 0.2, pph: rng() }); }
    const pos = (n, t) => [n.bx + Math.sin(t * n.sp + n.ph) * n.amp, n.by + Math.cos(t * n.sp * 0.8 + n.ph2) * n.amp];
    return function drawBg(t, gA, ordered = 0.4) {
      x.clearRect(0, 0, 1080, 1920); x.lineWidth = 1.2;
      for (const cn of CONN) { const [ax, ay] = pos(cn.a, t), [bx, by] = pos(cn.b, t);
        const a = (ordered + (1 - ordered) * Math.abs(Math.sin(t * 0.2 + cn.cph))) * 0.06 * gA;
        x.strokeStyle = `rgba(147,184,255,${a.toFixed(3)})`; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
        if (cn.pulse) { const p = ((t * cn.psp) + cn.pph) % 1, px = ax + (bx - ax) * p, py = ay + (by - ay) * p;
          x.fillStyle = `rgba(127,227,199,${(0.10 * gA).toFixed(3)})`; x.beginPath(); x.arc(px, py, 2.4, 0, 6.29); x.fill(); } }
      for (const n of NODES) { const [px, py] = pos(n, t), tw = 0.6 + 0.4 * Math.sin(t * n.sp * 1.7 + n.ph);
        x.fillStyle = `rgba(174,187,208,${(n.al * gA * tw).toFixed(3)})`; x.beginPath(); x.arc(px, py, n.rad, 0, 6.29); x.fill(); }
    };
  };

  // wire the ?t= preview + render bootstrap once the scene defines render()
  window.__bootScene = function () {
    const q = new URLSearchParams(location.search); const t0 = parseFloat(q.get('t') || '0');
    const go = () => window.render(t0);
    if (document.readyState !== 'loading') go(); else document.addEventListener('DOMContentLoaded', go);
  };
})();
