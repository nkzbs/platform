# Contesto di build: RADICE DEL REPO (non super-admin/frontend/) — per
# raggiungere shared/ nella radice (unica fonte di verità per schema-v3 e per
# i componenti Builder condivisi con core/frontend, vedi shared/frontend/).
# Comando: docker buildx build -f super-admin/frontend/Dockerfile . --load
FROM node:22-alpine AS builder
WORKDIR /app
COPY super-admin/frontend/package.json .
RUN npm install
COPY super-admin/frontend/ .
COPY shared/ /shared/
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY super-admin/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
