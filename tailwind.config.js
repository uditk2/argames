/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Palette pulled from design-mockup.html (night-sky / purple magic / fire-orange).
      colors: {
        magic: '#b079ff',
        fire: '#ff7a3c',
        'fire-bright': '#ffc25e',
        gold: '#ffd54a',
        shield: '#57e3ff',
        ink: '#f3e9ff',
        realm: '#0a0612',
        'realm-panel': 'rgba(20,9,38,.55)',
      },
      fontFamily: {
        display: ['"Cinzel Decorative"', 'serif'],
        body: ['Fredoka', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 22px rgba(176,121,255,.8)',
        'glow-fire': '0 0 20px rgba(255,122,60,.9)',
        'glow-shield': '0 0 24px rgba(87,227,255,.45)',
      },
    },
  },
  plugins: [],
};
