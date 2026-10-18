#!/usr/bin/env bash
# Aggiorna Platform sul NAS dal codice di questo repo.
#   bash scripts/redeploy-nas.sh                 tutto: backend + frontend + core
#   bash scripts/redeploy-nas.sh backend core    solo alcune parti
#
# Manda il sorgente al NAS, ricostruisce le immagini richieste (:0.1), sostituisce i container
# di Super Admin (se il nuovo non parte rimette il vecchio) e, per il core, aggiorna
# platform-core:latest e ricrea i tenant. Un tenant dove qualcuno è collegato in quel momento
# viene saltato (mai forzato): rilancia dopo qualche minuto.
set -euo pipefail
PARTS=("$@"); [ ${#PARTS[@]} -eq 0 ] && PARTS=(backend frontend provisioner core)
has() { local p; for p in "${PARTS[@]}"; do [ "$p" = "$1" ] && return 0; done; return 1; }

NAS="claude@192.168.1.2"; D=/usr/local/bin/docker; BUILD=/volume1/docker/platform-build-01; SECRETS=/volume1/docker/deploy-secrets
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; BK="$HOME/Desktop/platform-backup-nas"
nas() { ssh -p 1988 -o BatchMode=yes "$NAS" "$@"; }

echo "== Mando il sorgente"
nas "mkdir -p $BUILD && cd $BUILD && rm -rf core shared super-admin && tar -xzf - 2>/dev/null; true" < <(cd "$REPO" && COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=dist --exclude=.DS_Store -czf - core shared super-admin)

build() { # build DOCKERFILE IMMAGINE
  echo "== Costruisco $2"
  nas "cd $BUILD && $D build -q -f $1 -t $2:0.1 . >/dev/null && echo pronta"
}

# Sostituisce un container tenendo il vecchio finché il nuovo non risulta in esecuzione.
swap() { # swap NOME "opzioni docker run" IMMAGINE
  local name=$1 opts=$2 image=$3
  echo "== Sostituisco $name"
  nas "set -e
$D stop $name && $D rename $name $name-old
$D run -d --name $name $opts $image >/dev/null
sleep 3
if [ \"\$($D inspect -f '{{.State.Running}}' $name)\" != \"true\" ]; then
  echo 'ERRORE: il nuovo $name non è partito, ripristino il vecchio'
  $D logs --tail 15 $name 2>&1 | cut -c1-200
  $D rm -f $name || true; $D rename $name-old $name; $D start $name; exit 1
fi
$D rm $name-old
$D ps --format '{{.Names}}\t{{.Status}}' | grep -E \"^$name\""
}

if has backend; then
  build super-admin/backend/Dockerfile super-admin-backend
  swap super-admin-backend "--network platform_platform --restart unless-stopped -v platform-data:/data -v platform-nginx-config:/etc/nginx-shared -v /volume1/Dati/Backup/Platform:/offsite-backups --env-file $SECRETS/super-admin-backend.env -e DB_PATH=/data/super-admin-01.db" super-admin-backend:0.1
fi
if has frontend; then
  build super-admin/frontend/Dockerfile super-admin-frontend
  swap super-admin-frontend "--network platform_platform --restart unless-stopped" super-admin-frontend:0.1
fi
if has backend || has frontend; then
  nas "$D exec platform-nginx nginx -s reload 2>&1 | tail -1 || true"
fi

if has provisioner; then
  build super-admin/docker-provisioner/Dockerfile docker-provisioner
  swap docker-provisioner "--network platform_platform --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock --env-file $SECRETS/docker-provisioner.env -e PORT=4000 -e DATA_VOLUME=platform_platform-data -e TENANT_NETWORK=platform_platform" docker-provisioner:0.1
fi

if has core; then
  # Niente più build locale qui (18/10): /api/tenants/redeploy-all adesso builda da sé
  # platform-core:latest dal sorgente più recente su GitHub, dentro docker-provisioner
  # (vedi super-admin/docker-provisioner/src/docker.js buildCoreImage) — un build
  # doppio qui sarebbe solo tempo perso. Questo blocco resta solo per lanciare
  # il redeploy di tutti i tenant da riga di comando.
  echo "== Ricreo i tenant (la build dell'immagine la fa /redeploy-all da sé)"
  PW=$(cat "$BK/nas-super-admin-password.txt")
  api() { curl -s -X "$1" -H 'Host: admin.platform-core.it' -H 'Content-Type: application/json' ${TOKEN:+-H "Authorization: Bearer $TOKEN"} ${3:+-d "$3"} "http://192.168.1.2:4000/api$2"; }
  for i in $(seq 1 15); do
    RESP=$(api POST /auth/login "{\"username\":\"admin\",\"password\":\"$PW\"}")
    TOKEN=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).token||'')}catch(e){}})")
    [ -n "$TOKEN" ] && break
    # Super Admin che risponde con un JSON (password errata, 2FA, troppi tentativi) NON si riprova: ogni tentativo conta nel limite di accesso.
    printf '%s' "$RESP" | grep -q '^{' && { if printf '%s' "$RESP" | grep -q needs_2fa; then echo "Super Admin chiede il codice 2FA: l'immagine è pronta, premi Aggiorna sul tenant in Super Admin."; else echo "Super Admin rifiuta il login: $(printf '%s' "$RESP" | sed 's/"pending_token":"[^"]*"//g' | head -c 160)"; fi; exit 1; }
    sleep 2
  done
  [ -n "$TOKEN" ] || { echo "Login a Super Admin fallito"; exit 1; }
  api POST /tenants/redeploy-all '{}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);for(const r of (o.results||o)) console.log('  ',r.slug,'->',r.ok?'aggiornato':('saltato: '+(r.skipped||r.error)))}catch(e){console.log(s.slice(0,300))}})"
fi

echo "== Verifica"
sleep 8
for h in admin.platform-core.it finance.platform-core.it; do
  printf '  %-28s HTTP %s\n' "$h" "$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://$h/)"
done
nas "$D ps --format '{{.Names}}\t{{.Status}}' | grep -E 'platform-|super-admin|provisioner|redis'"
