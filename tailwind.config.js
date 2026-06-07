/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Palette is externalized to CSS variables in src/index.css (the single
      // source of truth). These reference the RGB-channel vars so Tailwind's
      // alpha modifiers keep working (e.g. text-magic/70, border-magic/40).
      colors: {
        magic: 'rgb(var(--magic-rgb) / <alpha-value>)',
        fire: 'rgb(var(--fire-rgb) / <alpha-value>)',
        'fire-bright': 'rgb(var(--fire-bright-rgb) / <alpha-value>)',
        gold: 'rgb(var(--gold-rgb) / <alpha-value>)',
        shield: 'rgb(var(--shield-rgb) / <alpha-value>)',
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        realm: 'rgb(var(--realm-rgb) / <alpha-value>)',
        'realm-panel': 'var(--panel)',
      },
      fontFamily: {
        display: ['"Cinzel Decorative"', 'serif'],
        body: ['Fredoka', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 22px rgb(var(--magic-rgb) / .8)',
        'glow-fire': '0 0 20px rgb(var(--fire-rgb) / .9)',
        'glow-shield': '0 0 24px rgb(var(--shield-rgb) / .45)',
      },
    },
  },
  plugins: [],
};
