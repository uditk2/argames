// ===========================================================================
// KEEPER AR — ICON GLYPHS (inline SVG strings)
// ---------------------------------------------------------------------------
// Drop-in replacements for the emoji used in the keeper-ar prototype:
//   🧤 -> ICON.glove   ⚽ -> ICON.ball    📊 -> ICON.telemetry
//   ✓  -> ICON.save    (goal) -> ICON.goal   ❤ -> ICON.heart
//   whistle -> ICON.whistle   level -> ICON.level   etc.
//
// Each export is a self-contained <svg> STRING that:
//   • uses `currentColor` for strokes/fills, so color comes from CSS `color`
//     (set it to var(--gold), var(--fire), etc. at the call site), and
//   • has viewBox 0 0 24 24, no fixed width/height (size via CSS).
//
// USAGE
//   element.innerHTML = ICON.glove;                 // raw
//   element.innerHTML = icon('glove', { size: 20, color: 'var(--gold)' });
//   const node = iconEl('save', { className: 'pip-icon' });  // -> SVGElement
// ===========================================================================

const svg = (inner, { stroke = true } = {}) =>
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" ` +
  `${stroke ? 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' : 'fill="currentColor"'} ` +
  `aria-hidden="true">${inner}</svg>`;

// --- Goalkeeper glove (replaces 🧤) -----------------------------------------
// A mitt: four fingers + thumb, cuff at the wrist.
export const glove = svg(`
  <path d="M7 11V5.6a1.3 1.3 0 0 1 2.6 0V10" />
  <path d="M9.6 9.4V4.3a1.3 1.3 0 0 1 2.6 0V9.6" />
  <path d="M12.2 9.6V5a1.3 1.3 0 0 1 2.6 0v5" />
  <path d="M14.8 10.2V7.4a1.3 1.3 0 0 1 2.5.2l.2 4.1" />
  <path d="M7 11c-1.5.4-2.2 1.6-1.6 3l1.4 3.3A4 4 0 0 0 11.6 20h2.2a4 4 0 0 0 4-3.2l.6-3.4c.2-1.3-.3-2.3-1-2.7" />
  <path d="M6.2 16.5h11.5" opacity="0.5" />
`);

// --- Soccer ball (replaces ⚽) ----------------------------------------------
export const ball = svg(`
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 6.5l3.2 2.3-1.2 3.8h-4L8.8 8.8 12 6.5z" />
  <path d="M12 6.5V4M15.2 8.8l2.4-1M13.9 12.6l1.6 2.2M10 12.6l-1.6 2.2M8.8 8.8l-2.4-1" opacity="0.7" />
`);

// --- Save / catch checkmark inside a shield (replaces ✓ for a save) ---------
export const save = svg(`
  <path d="M12 3.2l6.5 2.3v5.1c0 4.2-2.7 7.4-6.5 8.8-3.8-1.4-6.5-4.6-6.5-8.8V5.5L12 3.2z" />
  <path d="M8.8 11.8l2.3 2.4 4-4.6" />
`);

// --- Goal conceded — net with a ball passing through (replaces the GOAL X) ---
export const goal = svg(`
  <rect x="3.5" y="6" width="17" height="12" rx="0.6" />
  <path d="M7 6v12M11 6v12M15 6v12M3.5 10h17M3.5 14h17" opacity="0.45" />
  <circle cx="15.5" cy="13" r="2.6" fill="currentColor" stroke="none" />
`);

// --- Whistle (replaces referee whistle) -------------------------------------
export const whistle = svg(`
  <path d="M4 11.5h9.2a2.8 2.8 0 1 1 0 5.6H8.4A4.4 4.4 0 0 1 4 12.8v-1.3z" />
  <circle cx="10.4" cy="14.3" r="1.4" />
  <path d="M13.4 11.5l1.8-3.2M16 12l3-1.4M15.4 14.6l3.2.6" opacity="0.7" />
`);

// --- Level / chevrons-up rank badge -----------------------------------------
export const level = svg(`
  <path d="M6 13.5L12 8l6 5.5" />
  <path d="M6 17.5L12 12l6 5.5" opacity="0.6" />
`);

// --- Heart (lives) (replaces ❤) ---------------------------------------------
export const heart = svg(`
  <path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7C19 15.6 12 20 12 20z"
        fill="currentColor" stroke="none" />
`, { stroke: false });

// --- Heart outline (a lost life) --------------------------------------------
export const heartEmpty = svg(`
  <path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7C19 15.6 12 20 12 20z" />
`);

// --- Telemetry / stats bars (replaces 📊) -----------------------------------
export const telemetry = svg(`
  <path d="M4 20h16" />
  <rect x="5.5" y="12" width="3" height="6" rx="0.6" />
  <rect x="10.5" y="8" width="3" height="10" rx="0.6" />
  <rect x="15.5" y="4.5" width="3" height="13.5" rx="0.6" />
`);

// --- Target / aim reticle (shot zone) ---------------------------------------
export const target = svg(`
  <circle cx="12" cy="12" r="8" />
  <circle cx="12" cy="12" r="3.4" />
  <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
`);

// --- Play (start) -----------------------------------------------------------
export const play = svg(`<path d="M8 5.5l11 6.5-11 6.5V5.5z" fill="currentColor" stroke="none" />`, {
  stroke: false,
});

// --- Restart / replay -------------------------------------------------------
export const restart = svg(`
  <path d="M5 12a7 7 0 1 0 2.1-5" />
  <path d="M4.5 4.5v4h4" />
`);

// --- Mute / sound off --------------------------------------------------------
export const soundOn = svg(`
  <path d="M5 9.5v5h3l4 3.5V6L8 9.5H5z" fill="currentColor" stroke="none" />
  <path d="M15.5 9a4 4 0 0 1 0 6M17.8 7a7 7 0 0 1 0 10" />
`);
export const soundOff = svg(`
  <path d="M5 9.5v5h3l4 3.5V6L8 9.5H5z" fill="currentColor" stroke="none" />
  <path d="M16 9.5l4 5M20 9.5l-4 5" />
`);

// --- Stadium / arena (home / mode badge) ------------------------------------
export const stadium = svg(`
  <ellipse cx="12" cy="13" rx="9" ry="5" />
  <ellipse cx="12" cy="13" rx="4.5" ry="2.4" opacity="0.6" />
  <path d="M5 6.5l1.5 2M19 6.5l-1.5 2M12 5v2.5" opacity="0.7" />
`);

// Registry + helpers ---------------------------------------------------------
export const ICON = {
  glove,
  ball,
  save,
  goal,
  whistle,
  level,
  heart,
  heartEmpty,
  telemetry,
  target,
  play,
  restart,
  soundOn,
  soundOff,
  stadium,
};

/**
 * Return an icon SVG string with optional size/color applied inline.
 * @param {keyof typeof ICON} name
 * @param {{size?:number, color?:string, className?:string}} [opts]
 */
export function icon(name, opts = {}) {
  let s = ICON[name];
  if (!s) return '';
  const attrs = [];
  if (opts.size) attrs.push(`width="${opts.size}" height="${opts.size}"`);
  if (opts.color) attrs.push(`style="color:${opts.color}"`);
  if (opts.className) attrs.push(`class="${opts.className}"`);
  if (attrs.length) s = s.replace('<svg ', `<svg ${attrs.join(' ')} `);
  return s;
}

/** Return a live SVGElement (browser only). */
export function iconEl(name, opts = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, opts).trim();
  return tpl.content.firstChild;
}

export default ICON;
