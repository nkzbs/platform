// Stesso pattern di core/frontend/tailwind.config.js (withOpacity + CSS variable
// in index.css) — aggiunto per il Builder integrato copiato da lì, che usa
// bg-surface-card/text-ink/gray-* invece dei valori esadecimali diretti già
// usati altrove in Super Admin (rimasti invariati, questi si aggiungono soltanto).
import containerQueries from '@tailwindcss/container-queries'

function withOpacity(variableName) {
  return ({ opacityValue }) =>
    opacityValue !== undefined ? `rgb(var(${variableName}) / ${opacityValue})` : `rgb(var(${variableName}))`
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}', '../../shared/frontend/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        gray: {
          200: withOpacity('--gray-200'),
          300: withOpacity('--gray-300'),
          400: withOpacity('--gray-400'),
          500: withOpacity('--gray-500'),
          600: withOpacity('--gray-600'),
          700: withOpacity('--gray-700'),
          800: withOpacity('--gray-800'),
          900: withOpacity('--gray-900'),
        },
        'surface-page': withOpacity('--surface-page'),
        'surface-card': withOpacity('--surface-card'),
        'surface-input': withOpacity('--surface-input'),
        'surface-hover': withOpacity('--surface-hover'),
        'surface-footer': withOpacity('--surface-footer'),
        ink: withOpacity('--ink'),
        // PLATFORM-UI-RESKIN-PLAN.md, Fase 1 — token del brief non presenti
        // nella scala gray-*/surface-* originale (badge di stato/CTA). Non
        // ancora usati da nessuna pagina esistente (bg-blue-600/text-green-400
        // ecc. restano finché non si passa alle Fasi 2/3) — disponibili da qui
        // in poi per il lavoro pagina-per-pagina, non retrofittati ora.
        'cp-primary': withOpacity('--cp-primary'),
        // Alias: il Builder condiviso (shared/frontend/builder) usa il token 'accent' dell'app tenant.
        accent: withOpacity('--cp-primary'),
        'cp-primary-hover': withOpacity('--cp-primary-hover'),
        'cp-success': withOpacity('--cp-success'),
        'cp-success-bg': withOpacity('--cp-success-bg'),
        'cp-warning': withOpacity('--cp-warning'),
        'cp-warning-bg': withOpacity('--cp-warning-bg'),
        'cp-danger': withOpacity('--cp-danger'),
        'cp-danger-bg': withOpacity('--cp-danger-bg'),
        'cp-purple': withOpacity('--cp-purple'),
        // Fase 2 — voce di navigazione attiva nella Sidebar, colore esatto
        // del brief (#064b91), distinto da --cp-primary (#087bff, per CTA):
        // il brief li vuole diversi (blu scuro per lo stato attivo del menu,
        // blu acceso per i bottoni), non lo stesso valore riusato due volte.
        'cp-nav-active': withOpacity('--cp-nav-active'),
      },
    },
  },
  plugins: [containerQueries]
}
