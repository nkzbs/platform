// Controllo del codice: SOLO gli errori veri (variabili che non esistono, chiavi doppie, codice irraggiungibile, riassegnazioni di costanti…), non lo stile.
// Un'app che compila e supera i test può avere comunque un nome sbagliato in un ramo mai provato: questo lo trova prima.
const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', 'scripts/**', 'infra/**', 'eslint.config.js'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.es2021 } },
    rules: {
      'no-unused-vars': 'off', 'no-empty': 'off', 'no-useless-escape': 'off', 'no-prototype-builtins': 'off', 'no-control-regex': 'off',
      'no-inner-declarations': 'off', 'no-async-promise-executor': 'off', 'no-misleading-character-class': 'off', 'no-case-declarations': 'off', 'no-constant-condition': 'off', 'no-fallthrough': 'off',
    },
  },
  { files: ['shared/**/*.js'], languageOptions: { sourceType: 'module' } },
  // il plugin serve solo perché i file hanno commenti «eslint-disable react-hooks/…»: le sue regole non si applicano (solo errori veri)
  { files: ['**/frontend/**/*.js', '**/frontend/**/*.jsx'], plugins: { 'react-hooks': reactHooks }, languageOptions: { sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser } } },
  { files: ['**/frontend/vite.config.js', '**/frontend/postcss.config.js', '**/frontend/tailwind.config.js'], languageOptions: { sourceType: 'module', globals: { ...globals.node } } },
];
