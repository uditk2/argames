// ===========================================================================
// Home — the landing screen. Explains AR fitness games, the mission, and the
// stats/coaching angle, and gets players INTO a game fast via an always-present
// quick-play launcher (nav / hero / footer Play all open it; the game cards and
// picker cards launch directly). Calls onPlay(gameId) to mount a game.
// Theme is driven by the app's CSS variables (gold/fire on dark) so it stays in
// sync with the rest of SlayFit. Styles are scoped under `.sf-home`.
// ===========================================================================
import React, { useEffect, useRef, useState } from 'react';

const GAMES = [
  { id: 'dino', title: 'Dino Survival', meta: 'Full-body cardio · running',
    desc: 'Run in place to outrun the beast and reach the jeep. Beat your escape time.',
    img: '/assets/dino-survival/bg/trail.png' },
  { id: 'demon', title: 'Monster Punch', meta: 'Upper body · boxing & reflexes',
    desc: 'Punch what flies in and block with your arms — an arms, shoulders & reflex workout.',
    img: '/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png' },
];

export default function Home({ onPlay }) {
  const rootRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const open = () => setPickerOpen(true);
  const close = () => setPickerOpen(false);
  const play = (id) => { close(); onPlay && onPlay(id); };

  // scroll-reveal + the animated run-cycle skeletons (one in the hero, one in
  // the "how it works" step). Imperative SVG build, cleaned up on unmount.
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.14 });
    root.querySelectorAll('.reveal').forEach((el) => io.observe(el));

    const NS = 'http://www.w3.org/2000/svg';
    function buildSkel(svg) {
      const head = document.createElementNS(NS, 'circle'); head.setAttribute('class', 'head'); head.setAttribute('r', '17'); head.setAttribute('stroke-width', '2.6'); svg.appendChild(head);
      const L = {}; ['neck', 'spine', 'armLU', 'armLD', 'armRU', 'armRD', 'legLU', 'legLD', 'legRU', 'legRD'].forEach((n) => { const l = document.createElementNS(NS, 'line'); L[n] = l; svg.appendChild(l); });
      const J = {}; ['sh', 'hip', 'elbL', 'wrL', 'elbR', 'wrR', 'knL', 'anL', 'knR', 'anR'].forEach((n) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('class', 'j'); c.setAttribute('r', '4.5'); J[n] = c; svg.appendChild(c); });
      const set = (l, a, b, c, d) => { l.setAttribute('x1', a); l.setAttribute('y1', b); l.setAttribute('x2', c); l.setAttribute('y2', d); };
      const jt = (c, x, y) => { c.setAttribute('cx', x); c.setAttribute('cy', y); };
      const cx = 150;
      return (t) => {
        const s = Math.sin(t), bob = Math.abs(s) * 8, shY = 150 - bob, hipY = 235 - bob, headY = shY - 30;
        head.setAttribute('cx', cx); head.setAttribute('cy', headY);
        set(L.neck, cx, headY + 17, cx, shY); set(L.spine, cx, shY, cx, hipY);
        const elbL = [cx - 28 + 14 * s, shY + 34], wrL = [cx - 30 + 30 * s, shY + 66], elbR = [cx + 28 - 14 * s, shY + 34], wrR = [cx + 30 - 30 * s, shY + 66];
        set(L.armLU, cx, shY + 6, elbL[0], elbL[1]); set(L.armLD, elbL[0], elbL[1], wrL[0], wrL[1]);
        set(L.armRU, cx, shY + 6, elbR[0], elbR[1]); set(L.armRD, elbR[0], elbR[1], wrR[0], wrR[1]);
        const knL = [cx - 10 + 26 * s, hipY + 44 - 10 * Math.max(0, s)], anL = [cx - 12 + 44 * s, hipY + 96 - 22 * Math.max(0, s)];
        const knR = [cx + 10 - 26 * s, hipY + 44 - 10 * Math.max(0, -s)], anR = [cx + 12 - 44 * s, hipY + 96 - 22 * Math.max(0, -s)];
        set(L.legLU, cx, hipY, knL[0], knL[1]); set(L.legLD, knL[0], knL[1], anL[0], anL[1]);
        set(L.legRU, cx, hipY, knR[0], knR[1]); set(L.legRD, knR[0], knR[1], anR[0], anR[1]);
        jt(J.sh, cx, shY); jt(J.hip, cx, hipY); jt(J.elbL, ...elbL); jt(J.wrL, ...wrL); jt(J.elbR, ...elbR); jt(J.wrR, ...wrR); jt(J.knL, ...knL); jt(J.anL, ...anL); jt(J.knR, ...knR); jt(J.anR, ...anR);
      };
    }
    const updaters = [...root.querySelectorAll('[data-skel]')].map(buildSkel);
    let raf, t = 0;
    const loop = () => { t += 0.13; updaters.forEach((u) => u(t)); raf = requestAnimationFrame(loop); };
    loop();
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  // Esc closes the picker.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  const PlayIcon = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>);

  return (
    <div className="sf-home" ref={rootRef}>
      <style>{CSS}</style>

      <nav><div className="wrap row">
        <div className="brand">SLAY<b>FIT</b></div>
        <div className="navlinks">
          <a href="#games">Games</a><a href="#mission">Mission</a><a href="#how">How it works</a><a href="#stats">Your stats</a>
          <button className="btn btn-fire navplay" onClick={open}>Play</button>
        </div>
      </div></nav>

      {/* HERO */}
      <header className="wrap hero">
        <div className="reveal in">
          <div className="eyebrow">Webcam AR fitness</div>
          <h1 className="disp">Get fit <span className="grad">without<br />noticing.</span></h1>
          <p className="lead">SlayFit turns your webcam into the controller and drops you inside the game. Run from a beast, throw real punches, dodge with your body — a genuine workout you'll forget you're even doing. And it quietly coaches your running as you play.</p>
          <div className="cta">
            <button className="btn btn-fire" onClick={open}><PlayIcon /> Start a session</button>
            <a className="btn btn-line" href="#how">How it works</a>
          </div>
          <div className="kpis">
            <div><div className="n grad">0</div><div className="l">gear required</div></div>
            <div><div className="n grad">30/s</div><div className="l">pose reads</div></div>
            <div><div className="n grad">100%</div><div className="l">on-device</div></div>
          </div>
        </div>
        <div className="viewport reveal in">
          <span className="corner vp-tl" /><span className="corner vp-tr" /><span className="corner vp-bl" /><span className="corner vp-br" />
          <div className="hud"><span className="rec"><i />Live</span><span>Pose · on-device</span></div>
          <div className="scan" />
          <svg className="skel" data-skel viewBox="0 0 300 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />
          <div className="cadence"><b>178 spm</b><small>cadence detected</small></div>
        </div>
      </header>

      {/* MISSION */}
      <section className="mission" id="mission"><div className="wrap reveal">
        <div className="eyebrow">Our mission</div>
        <p className="stmt">Make people fit through <span className="grad">games and technology</span> — workouts you actually want to repeat tomorrow.</p>
        <div className="rule" />
      </div></section>

      {/* GAMES */}
      <section id="games"><div className="wrap">
        <div className="reveal"><div className="eyebrow">Choose your session</div><div className="lead-h disp">Two ways to break a sweat.</div></div>
        <div className="grow">
          {GAMES.map((g) => (
            <button key={g.id} className="gcard reveal" onClick={() => play(g.id)}>
              <img src={g.img} alt="" /><div className="sh" />
              <div className="b"><div className="meta">{g.meta}</div><h3 className="disp">{g.title}</h3><p>{g.desc}</p></div>
            </button>
          ))}
        </div>
      </div></section>

      {/* HOW IT WORKS */}
      <section id="how"><div className="wrap">
        <div className="reveal"><div className="eyebrow">What is an AR game?</div>
          <div className="lead-h disp">Reality is the level. You are player one.</div>
          <p className="sub">Augmented-reality games merge your real movement with a digital world — no headset, just your webcam. The camera tracks your body, so the way you move is the input.</p>
        </div>
        <div className="ar">
          <div className="arc reveal"><div className="arstage"><div className="cam" /></div><div className="arnum">01</div><h3>The camera sees you</h3><p>Stand in frame. Your webcam streams to an on-device pose model — nothing ever leaves your machine.</p></div>
          <div className="arc reveal"><div className="arstage"><svg className="skel" data-skel viewBox="0 0 300 400" width="120" height="160" preserveAspectRatio="xMidYMid meet" /></div><div className="arnum">02</div><h3>AI maps your skeleton</h3><p>Knees, hips and wrists are tracked thirty times a second — your cadence, stride and guard, live.</p></div>
          <div className="arc reveal"><div className="arstage"><div className="avwrap"><img src="/assets/home/pose-controller.png" alt="A player with the live pose-tracking skeleton on them" /></div></div><div className="arnum">03</div><h3>You become the controller</h3><p>Your movement drives the game instantly — run faster and the world flies by; stop, and so do you.</p></div>
        </div>
      </div></section>

      {/* STATS */}
      <section id="stats"><div className="wrap">
        <div className="reveal"><div className="eyebrow">Stats &amp; coaching</div>
          <div className="lead-h disp">Your running, measured every time you play.</div>
          <p className="sub">We collect your movement stats — cadence, symmetry, consistency, calories — to track progress over time and give you specific, personal recommendations to run better.</p>
        </div>
        <div className="report reveal">
          <div className="rleft">
            <div className="eyebrow">Run report</div>
            <div className="ring"><div><b>92%</b><small>CONSISTENCY</small></div></div>
            <div className="rnote">A high, steady cadence with even left/right balance — you held form as you tired.</div>
          </div>
          <div className="rright">
            <div className="metric"><span>Avg cadence</span><span className="v">176 <small>spm</small></span></div>
            <div className="metric"><span>Peak cadence</span><span className="v">198 <small>spm</small></span></div>
            <div className="metric"><span>Left / right balance</span><span className="v">51 / 49</span></div>
            <div className="metric"><span>Active time · calories</span><span className="v">48s · ~96</span></div>
            <div className="reco"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18 L11 11 L15 15 L20 8" /><path d="M20 8 H15 M20 8 V13" /></svg><div><b>Recommendation:</b> aim for <b>180 spm</b> next run. A +4 spm lift is about 5% more efficient for the same effort — and shortening your ground contact will smooth that left-side dip.</div></div>
          </div>
        </div>
      </div></section>

      <footer><div className="wrap reveal">
        <div className="eyebrow">Move to play</div>
        <div className="disp grad footbig">Get fit without noticing.</div>
        <button className="btn btn-fire footcta" onClick={open}><PlayIcon /> Start a session</button>
      </div></footer>

      {/* QUICK-PLAY LAUNCHER */}
      <div className={'sf-modal' + (pickerOpen ? ' open' : '')} onClick={(e) => { if (e.target.classList.contains('sf-modal')) close(); }}>
        <div className="panel">
          <button className="x" aria-label="Close" onClick={close}>&times;</button>
          <h3 className="disp">Choose your game</h3>
          <div className="sub2">Camera on, stand back, go. You can switch any time.</div>
          <div className="pick">
            {GAMES.map((g) => (
              <button key={g.id} className="pcard" onClick={() => play(g.id)}>
                <img src={g.img} alt="" /><div className="sh" />
                <div className="b"><div className="meta">{g.meta}</div><h4 className="disp">{g.title}</h4><span className="go"><PlayIcon /> Play</span></div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Scoped styles. Local vars map onto the app's theme variables so Home restyles
// with the rest of SlayFit from one source.
const CSS = `
.sf-home{ --gold:rgb(var(--magic-rgb)); --fire:rgb(var(--fire-rgb)); --ember:rgb(var(--fire-bright-rgb));
  --ink:rgb(var(--ink-rgb)); --muted:#a89e8c; --realm:rgb(var(--realm-rgb)); --panel:#0f0b18;
  --g1:var(--brand-grad-1); --g2:var(--brand-grad-2);
  position:fixed; inset:0; overflow-y:auto; background:var(--realm); color:var(--ink);
  font-family:Fredoka,system-ui,sans-serif; line-height:1.5;
  background-image:radial-gradient(120% 80% at 50% -10%, rgb(var(--magic-rgb)/.10), transparent 55%); }
.sf-home *{box-sizing:border-box}
.sf-home .disp{font-family:'Cinzel Decorative',serif;font-weight:900}
.sf-home a{color:inherit;text-decoration:none}
.sf-home .wrap{max-width:1160px;margin:0 auto;padding:0 26px}
.sf-home .eyebrow{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:var(--gold);font-weight:600}
.sf-home .grad{background:linear-gradient(90deg,var(--g1),var(--g2));-webkit-background-clip:text;background-clip:text;color:transparent}
.sf-home .btn{display:inline-flex;align-items:center;gap:9px;font-weight:600;border-radius:999px;padding:14px 28px;font-size:15px;cursor:pointer;border:0;transition:.2s;font-family:Fredoka}
.sf-home .btn-fire{color:#190c05;background:linear-gradient(90deg,var(--g1),var(--g2))}
.sf-home .btn-fire:hover{filter:brightness(1.07);transform:translateY(-1px)}
.sf-home .btn-line{color:var(--ink);background:transparent;border:1px solid rgb(var(--magic-rgb)/.4)}
.sf-home .btn-line:hover{border-color:var(--gold);background:rgb(var(--magic-rgb)/.07)}
.sf-home .btn svg{width:15px;height:15px}
.sf-home nav{position:fixed;top:0;left:0;right:0;z-index:40;backdrop-filter:blur(8px);background:linear-gradient(180deg,rgb(var(--realm-rgb)/.7),transparent)}
.sf-home nav .row{display:flex;align-items:center;justify-content:space-between;height:72px}
.sf-home .brand{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:21px;letter-spacing:2px}
.sf-home .brand b{color:var(--gold)}
.sf-home .navlinks{display:flex;gap:26px;align-items:center;font-size:14px;color:var(--muted)}
.sf-home .navlinks a:hover{color:var(--ink)}
.sf-home .navplay{padding:9px 20px}
.sf-home .hero{min-height:100vh;display:grid;grid-template-columns:1.05fr .95fr;align-items:center;gap:46px;padding-top:72px}
.sf-home .hero h1{font-size:clamp(40px,6vw,76px);line-height:1.02;letter-spacing:.5px}
.sf-home .hero .lead{color:#d9d0c1;font-size:clamp(16px,1.6vw,19px);max-width:44ch;margin-top:22px}
.sf-home .hero .cta{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}
.sf-home .kpis{display:flex;gap:34px;margin-top:40px}
.sf-home .kpis .n{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:28px}
.sf-home .kpis .l{font-size:12px;color:var(--muted);letter-spacing:.06em;margin-top:2px}
.sf-home .viewport{position:relative;aspect-ratio:3/4;max-height:78vh;margin-left:auto;width:100%;border-radius:26px;overflow:hidden;background:radial-gradient(120% 90% at 50% 6%, #211641, #0b0716);border:1px solid rgb(var(--magic-rgb)/.3);box-shadow:0 34px 90px rgba(0,0,0,.6), inset 0 0 60px rgb(var(--magic-rgb)/.06)}
.sf-home .corner{position:absolute;width:26px;height:26px;border:2px solid rgb(var(--magic-rgb)/.55)}
.sf-home .vp-tl{top:14px;left:14px;border-right:0;border-bottom:0;border-radius:6px 0 0 0}
.sf-home .vp-tr{top:14px;right:14px;border-left:0;border-bottom:0;border-radius:0 6px 0 0}
.sf-home .vp-bl{bottom:14px;left:14px;border-right:0;border-top:0;border-radius:0 0 0 6px}
.sf-home .vp-br{bottom:14px;right:14px;border-left:0;border-top:0;border-radius:0 0 6px 0}
.sf-home .hud{position:absolute;top:18px;left:20px;right:20px;display:flex;justify-content:space-between;font-size:11px;letter-spacing:.14em;color:var(--ember);text-transform:uppercase}
.sf-home .rec{display:flex;align-items:center;gap:7px}
.sf-home .rec i{width:9px;height:9px;border-radius:50%;background:var(--fire);box-shadow:0 0 10px var(--fire);animation:sfblink 1.1s infinite}
@keyframes sfblink{50%{opacity:.25}}
.sf-home .cadence{position:absolute;bottom:18px;left:20px}
.sf-home .cadence b{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:22px}
.sf-home .cadence small{display:block;font-size:10px;letter-spacing:.2em;color:var(--gold);text-transform:uppercase;margin-top:1px}
.sf-home .scan{position:absolute;left:6%;right:6%;height:2px;background:linear-gradient(90deg,transparent,rgb(var(--magic-rgb)/.85),transparent);animation:sfscan 3s ease-in-out infinite}
@keyframes sfscan{0%,100%{top:10%}50%{top:88%}}
.sf-home .skel line{stroke:var(--gold);stroke-width:2.6;stroke-linecap:round;filter:drop-shadow(0 0 6px rgb(var(--magic-rgb)/.7))}
.sf-home .skel circle.j{fill:var(--ember)}
.sf-home .skel circle.head{fill:none;stroke:var(--gold)}
.sf-home section{padding:104px 0;border-top:1px solid rgba(255,255,255,.05)}
.sf-home .lead-h{font-size:clamp(28px,3.8vw,46px);line-height:1.12;max-width:18ch}
.sf-home .sub{color:#cfc6b6;margin-top:16px;max-width:58ch;font-size:clamp(16px,1.5vw,19px)}
.sf-home .mission{background:linear-gradient(180deg,rgb(var(--fire-rgb)/.10),transparent);text-align:center}
.sf-home .mission .stmt{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:clamp(26px,4vw,46px);line-height:1.25;max-width:20ch;margin:14px auto 0}
.sf-home .mission .rule{width:60px;height:3px;background:linear-gradient(90deg,var(--g1),var(--g2));margin:26px auto 0;border-radius:2px}
.sf-home .grow{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:34px}
.sf-home .gcard{position:relative;height:340px;border-radius:24px;overflow:hidden;border:1px solid rgb(var(--magic-rgb)/.22);transition:.25s;cursor:pointer;text-align:left;padding:0;background:none;color:inherit;font:inherit;display:block;width:100%}
.sf-home .gcard:hover{transform:translateY(-5px);border-color:var(--gold);box-shadow:0 26px 60px rgb(var(--fire-rgb)/.22)}
.sf-home .gcard img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:.5s}
.sf-home .gcard:hover img{transform:scale(1.06)}
.sf-home .gcard .sh{position:absolute;inset:0;background:linear-gradient(0deg,rgb(var(--realm-rgb)/.96),rgb(var(--realm-rgb)/.15) 60%,transparent)}
.sf-home .gcard .b{position:absolute;bottom:0;padding:26px}
.sf-home .gcard h3{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:27px}
.sf-home .gcard p{color:#ddd3c2;font-size:14.5px;margin-top:5px}
.sf-home .gcard .meta{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:9px}
.sf-home .ar{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:50px}
.sf-home .arc{background:linear-gradient(180deg,rgb(var(--realm-tint-rgb)/.5),rgba(16,10,26,.5));border:1px solid rgb(var(--magic-rgb)/.22);border-radius:22px;padding:28px;text-align:center}
.sf-home .arstage{height:150px;display:grid;place-items:center;margin-bottom:18px}
.sf-home .arc h3{font-size:22px;font-weight:600;margin-bottom:8px}
.sf-home .arc p{color:var(--muted);font-size:15.5px;line-height:1.55}
.sf-home .arnum{font-family:'Cinzel Decorative',serif;font-weight:900;color:var(--gold);font-size:14px;letter-spacing:.1em}
.sf-home .cam{width:96px;height:74px;border:2px solid var(--gold);border-radius:12px;position:relative;box-shadow:0 0 24px rgb(var(--magic-rgb)/.25)}
.sf-home .cam:before{content:"";position:absolute;width:30px;height:30px;border:2px solid var(--ember);border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%)}
.sf-home .cam:after{content:"";position:absolute;left:8px;right:8px;height:2px;background:linear-gradient(90deg,transparent,var(--gold),transparent);animation:sfscan2 2.4s ease-in-out infinite}
@keyframes sfscan2{0%,100%{top:12px}50%{top:58px}}
.sf-home .avwrap{position:relative;height:150px;display:grid;place-items:center}
.sf-home .avwrap img{height:150px;object-fit:contain;filter:drop-shadow(0 4px 14px rgba(0,0,0,.5));animation:sfbob 2.6s ease-in-out infinite}
@keyframes sfbob{50%{transform:translateY(-9px)}}
.sf-home .report{display:grid;grid-template-columns:.85fr 1.15fr;border:1px solid rgb(var(--magic-rgb)/.22);border-radius:24px;overflow:hidden;background:var(--panel);margin-top:34px}
.sf-home .rleft{padding:36px;background:linear-gradient(180deg,rgb(var(--fire-rgb)/.10),transparent)}
.sf-home .rright{padding:36px;border-left:1px solid rgba(255,255,255,.06)}
.sf-home .rnote{font-size:13.5px;color:var(--muted)}
.sf-home .ring{--p:92;width:132px;height:132px;border-radius:50%;display:grid;place-items:center;margin:10px 0 18px;background:conic-gradient(var(--gold) calc(var(--p)*1%), rgba(255,255,255,.08) 0)}
.sf-home .ring div{width:100px;height:100px;border-radius:50%;background:var(--panel);display:grid;place-items:center;text-align:center}
.sf-home .ring b{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:26px}
.sf-home .ring small{font-size:10px;color:var(--muted);letter-spacing:.1em}
.sf-home .metric{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:15px}
.sf-home .metric:last-of-type{border:0}
.sf-home .metric .v{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:21px}
.sf-home .metric .v small{font-family:Fredoka;font-weight:400;font-size:12px;color:var(--muted)}
.sf-home .reco{margin-top:18px;background:rgb(var(--magic-rgb)/.08);border:1px solid rgb(var(--magic-rgb)/.25);border-radius:14px;padding:15px 17px;font-size:14.5px;color:#ece3d3;line-height:1.55;display:flex;gap:12px}
.sf-home .reco b{color:var(--gold)}
.sf-home .reco svg{flex:0 0 auto;width:20px;height:20px;color:var(--gold);margin-top:2px}
.sf-home footer{padding:96px 0;text-align:center;border-top:1px solid rgba(255,255,255,.06)}
.sf-home .footbig{font-size:clamp(30px,4.4vw,52px);margin-top:12px}
.sf-home .footcta{margin-top:26px}
.sf-home .reveal{opacity:0;transform:translateY(20px);transition:.7s cubic-bezier(.2,.7,.2,1)}
.sf-home .reveal.in{opacity:1;transform:none}
.sf-modal{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(6,3,12,.8);backdrop-filter:blur(10px)}
.sf-modal.open{display:flex}
.sf-modal .panel{width:min(840px,95vw);background:#0f0b18;border:1px solid rgb(var(--magic-rgb)/.3);border-radius:26px;padding:32px;position:relative;box-shadow:0 30px 90px rgba(0,0,0,.6);font-family:Fredoka,system-ui,sans-serif;color:rgb(var(--ink-rgb))}
.sf-modal .x{position:absolute;top:14px;right:18px;background:transparent;border:0;color:#a89e8c;font-size:26px;cursor:pointer;line-height:1}
.sf-modal .x:hover{color:rgb(var(--ink-rgb))}
.sf-modal h3{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:25px;text-align:center}
.sf-modal .sub2{text-align:center;color:#a89e8c;font-size:14px;margin-top:6px}
.sf-modal .pick{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}
.sf-modal .pcard{position:relative;height:240px;border-radius:18px;overflow:hidden;border:1px solid rgb(var(--magic-rgb)/.25);cursor:pointer;transition:.2s;padding:0;background:none;text-align:left;width:100%;color:inherit;font:inherit}
.sf-modal .pcard:hover{border-color:rgb(var(--magic-rgb));transform:translateY(-3px)}
.sf-modal .pcard img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sf-modal .pcard .sh{position:absolute;inset:0;background:linear-gradient(0deg,rgb(var(--realm-rgb)/.96),transparent 62%)}
.sf-modal .pcard .b{position:absolute;bottom:0;padding:18px}
.sf-modal .pcard .meta{font-size:10.5px;letter-spacing:.15em;text-transform:uppercase;color:rgb(var(--magic-rgb));margin-bottom:6px}
.sf-modal .pcard h4{font-family:'Cinzel Decorative',serif;font-weight:900;font-size:20px}
.sf-modal .pcard .go{margin-top:10px;display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13px;color:#190c05;background:linear-gradient(90deg,var(--brand-grad-1),var(--brand-grad-2));padding:8px 16px;border-radius:999px}
.sf-modal .pcard .go svg{width:12px;height:12px}
@media(max-width:880px){.sf-home .hero{grid-template-columns:1fr;padding-top:96px;min-height:auto;padding-bottom:50px}.sf-home .viewport{max-height:64vh;max-width:400px}.sf-home .ar,.sf-home .grow,.sf-home .report{grid-template-columns:1fr}.sf-home .rright{border-left:0;border-top:1px solid rgba(255,255,255,.06)}}
@media(max-width:620px){.sf-modal .pick{grid-template-columns:1fr}.sf-modal .pcard{height:160px}}
`;
