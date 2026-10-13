// Compone `rgb(var(--x) / <alpha>)` invece di un riferimento diretto a `var(--x)`
// — necessario perché Tailwind possa applicare i modificatori di opacità
// (es. border-gray-800/50) alle CSS variable. Con `var(--x)` semplice, Tailwind
// non ha modo di iniettare un canale alpha e le varianti /NN non generano
// nessuna regola CSS (la classe finiva nel markup senza stile, bordo su
// currentColor invece del grigio tenue voluto). Le CSS variable in index.css
// sono quindi triplette RGB separate da spazi ("31 41 55"), non esadecimale.
function withOpacity(variableName) {
  return ({ opacityValue }) =>
    opacityValue !== undefined ? `rgb(var(${variableName}) / ${opacityValue})` : `rgb(var(${variableName}))`
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}', '../../shared/frontend/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Superfici e scala dei grigi come variabili CSS: stessi valori di sempre come
      // default (nessun cambiamento visivo per chi non tocca il toggle), sovrascritti
      // sotto [data-theme="light"] (vedi index.css) con la palette "stone" di nico —
      // così TUTTE le centinaia di classi text-gray-*/border-gray-*/bg-gray-* già
      // usate in ogni componente diventano automaticamente theme-aware senza dover
      // toccare un solo file .jsx.
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
        // Colore di brand del tenant (white-label minimo) — a differenza di
        // gray-*/surface-* NON è tema-aware (stesso valore in chiaro/scuro,
        // scelto dal tenant stesso), solo runtime-aware: il default qui è
        // identico al blue-600 hardcoded ancora usato in centinaia di punti
        // dell'app, sovrascritto via JS solo dove un tenant ha impostato un
        // colore proprio (vedi App.jsx). Applicato oggi solo alla Sidebar e
        // al pulsante primario di Login — non un retheme completo dell'app.
        accent: withOpacity('--accent'),
        'cp-success': withOpacity('--cp-success'),
        'cp-success-bg': withOpacity('--cp-success-bg'),
        'cp-warning': withOpacity('--cp-warning'),
        'cp-warning-bg': withOpacity('--cp-warning-bg'),
        'cp-danger': withOpacity('--cp-danger'),
        'cp-danger-bg': withOpacity('--cp-danger-bg'),
        'cp-purple': withOpacity('--cp-purple'),
      },
    },
  },
  plugins: []
}
