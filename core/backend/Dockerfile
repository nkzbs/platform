FROM node:22-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json .
RUN npm install
COPY src/ ./src/
EXPOSE 3000
CMD ["node", "src/index.js"]
