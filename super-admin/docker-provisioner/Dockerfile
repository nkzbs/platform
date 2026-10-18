# G2 (PLATFORM-0.6-GAP-ANALYSIS.md) — questo è l'UNICO container che monta
# /var/run/docker.sock in tutta la piattaforma (vedi docker-compose.yml). Nessuna
# dipendenza nativa da compilare (dockerode è puro JS), a differenza di
# super-admin/backend/Dockerfile — non serve python3/make/g++ qui.
# Niente pacchetto git: buildCoreImage() (docker.js) scarica il sorgente più
# recente da GitHub via tarball HTTPS (`tar` di busybox, già incluso in
# alpine, basta a estrarlo) prima di ogni build di platform-core:latest —
# stesso identico sorgente che prima arrivava via `tar` dal laptop dello
# sviluppatore (scripts/redeploy-nas.sh), ora recuperato qui dentro così
# "Aggiorna" nel pannello Tenant non dipende più da un passaggio esterno.
# `git clone` era il primo tentativo (18/10): fallisce dentro questo
# container con "unable to get random bytes…Function not implemented" — il
# seccomp del Docker Engine del NAS (Synology, versione datata) blocca la
# syscall getrandom() che git usa per i file temporanei di un clone; un
# download HTTPS normale (Node/OpenSSL, che ripiegano su /dev/urandom) non
# ne risente.
FROM node:22-alpine
WORKDIR /app
COPY super-admin/docker-provisioner/package.json super-admin/docker-provisioner/package-lock.json ./
RUN npm ci --omit=dev
COPY super-admin/docker-provisioner/src/ ./src/
EXPOSE 4000
CMD ["node", "src/index.js"]
