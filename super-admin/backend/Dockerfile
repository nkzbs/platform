# Build context: RADICE del repo (non più super-admin/backend/) — serve per
# raggiungere shared/, esattamente come core/Dockerfile fa già. Prima di questo
# (2026-08-10, rate limiting) questo backend non aveva alcuna dipendenza reale
# su shared/, quindi non serviva; ora sì. Ogni COPY sotto è quindi prefissata
# con super-admin/backend/.
FROM node:22-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY super-admin/backend/package.json .
RUN npm install
COPY super-admin/backend/src/ ./src/
COPY shared/ /shared/
EXPOSE 3000
CMD ["node", "src/index.js"]
