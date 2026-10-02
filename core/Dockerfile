# Contesto di build: RADICE DEL REPO (non core/) — necessario perché sia questa
# immagine sia super-admin/frontend devono raggiungere shared/ nella radice
# (unica fonte di verità per schema-v3, vedi shared/schema-v3-core.js). Tutti i
# path sorgente delle COPY sotto sono quindi prefissati con core/; le
# destinazioni dentro il container restano esattamente quelle di prima
# (/frontend, /app, /shared) — nessun require()/import relativo da toccare.
# Comando: docker buildx build -f core/Dockerfile . --load (dalla radice del repo)

# Stage 1: build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /frontend
COPY core/frontend/package.json .
RUN npm install
COPY core/frontend/ .
COPY shared/ /shared/
RUN npm run build

# Stage 2: build backend deps
FROM node:22-alpine AS backend-builder
RUN apk add --no-cache python3 make g++
WORKDIR /backend
COPY core/backend/package.json .
RUN npm install

# Stage 3: immagine finale
FROM node:22-alpine
RUN apk add --no-cache nginx supervisor

# NODE_ENV=production fissato QUI, nell'immagine (2026-09-04) — bug reale
# trovato durante una verifica dal vivo sulla NAS di produzione: era stato
# impostato manualmente sul container vivo di Coffee/Finance il 2026-08-23
# (docker update, mai in questo Dockerfile né in una colonna della tabella
# tenants), e ogni redeployTenant() successivo lo perdeva silenziosamente
# ricreando il container da zero — verificato che sia Coffee sia Finance
# non lo avevano più dopo i redeploy di stasera. Le protezioni collegate
# (G1 boot-guard sui secret deboli, G13 rate-limit fail-closed) erano
# quindi silenziosamente inattive su entrambi i tenant reali. Qui, non in
# una variabile per-tenant che un redeploy può dimenticare di ricostruire:
# ogni container nato da questa immagine lo ha per costruzione, per
# sempre — stesso principio già seguito per node:22-alpine fisso nel
# Dockerfile invece che dipendere dalla versione locale di sviluppo.
ENV NODE_ENV=production

# Backend
WORKDIR /app
COPY core/backend/src/ ./src/
COPY core/backend/package.json .
COPY --from=backend-builder /backend/node_modules ./node_modules
# Stesso file condiviso della build frontend (vedi sopra) — stesso path assoluto
# /shared, così core/backend/src/schema-v3.js lo trova con lo stesso require()
# relativo (../../shared/) usato anche in locale.
COPY shared/ /shared/

# Frontend build statica
COPY --from=frontend-builder /frontend/dist /usr/share/nginx/html

# Config nginx
COPY core/nginx.conf /etc/nginx/nginx.conf

# Config supervisord
COPY core/supervisord.conf /etc/supervisord.conf

EXPOSE 80
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
