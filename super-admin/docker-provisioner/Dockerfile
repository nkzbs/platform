# G2 (PLATFORM-0.6-GAP-ANALYSIS.md) — questo è l'UNICO container che monta
# /var/run/docker.sock in tutta la piattaforma (vedi docker-compose.yml). Nessuna
# dipendenza nativa da compilare (dockerode è puro JS), a differenza di
# super-admin/backend/Dockerfile — non serve python3/make/g++ qui.
# git: serve a buildCoreImage() (docker.js) per scaricare il sorgente più
# recente da GitHub prima di ogni build di platform-core:latest — stesso
# identico sorgente che prima arrivava via `tar` dal laptop dello sviluppatore
# (scripts/redeploy-nas.sh), ora recuperato direttamente qui dentro così
# "Aggiorna" nel pannello Tenant non dipende più da un passaggio esterno.
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY super-admin/docker-provisioner/package.json super-admin/docker-provisioner/package-lock.json ./
RUN npm ci --omit=dev
COPY super-admin/docker-provisioner/src/ ./src/
EXPOSE 4000
CMD ["node", "src/index.js"]
