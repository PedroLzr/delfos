/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { ink: '#101211', panel: '#161917', line: '#2b302c', muted: '#929a93', sage: '#b4c5a4' },
    fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"SFMono-Regular"', 'Consolas', 'monospace'] },
    keyframes: { 'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } } },
    animation: { 'fade-in': 'fade-in 300ms ease-out' },
  } }, plugins: [],
};
