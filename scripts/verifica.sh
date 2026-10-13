#!/usr/bin/env bash
# Controllo completo prima di mettere online: lint (errori veri), test del core e di Super Admin, compilazione dei due frontend.
# Uso: bash scripts/verifica.sh        (circa 3 minuti)   |   bash scripts/verifica.sh veloce   (solo lint, pochi secondi)
set -u
cd "$(dirname "$0")/.."
esito=0
passo() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fallito() { printf '\033[31m✗ %s\033[0m\n' "$1"; esito=1; }

passo "Lint (nomi che non esistono, codice irraggiungibile…)"
npx eslint . || fallito "lint"
if [ "${1:-}" = "veloce" ]; then [ $esito -eq 0 ] && echo "✓ lint pulito" ; exit $esito; fi

passo "Test del core";            (cd core/backend && npm test >/tmp/verifica-core.log 2>&1) && echo "✓ core" || { tail -20 /tmp/verifica-core.log; fallito "test del core"; }
passo "Test di Super Admin";      (cd super-admin/backend && npm test >/tmp/verifica-sa.log 2>&1) && echo "✓ super admin" || { tail -20 /tmp/verifica-sa.log; fallito "test di Super Admin"; }
passo "Compilazione frontend core";  (cd core/frontend && npx vite build >/tmp/verifica-fc.log 2>&1) && echo "✓ frontend core" || { tail -20 /tmp/verifica-fc.log; fallito "frontend core"; }
passo "Compilazione frontend Super Admin"; (cd super-admin/frontend && npx vite build >/tmp/verifica-fs.log 2>&1) && echo "✓ frontend super admin" || { tail -20 /tmp/verifica-fs.log; fallito "frontend Super Admin"; }

[ $esito -eq 0 ] && printf '\n\033[32m✓ Tutto a posto: si può mettere online.\033[0m\n' || printf '\n\033[31m✗ Qualcosa non va: non mettere online.\033[0m\n'
exit $esito
