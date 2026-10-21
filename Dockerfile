# The game server: builds the game (served from the domain's root) and the server bundle, then
# runs both in one small image. Used for the live and the demo server (fly.toml, fly.demo.toml).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG BUILD_ID=local
ENV GITHUB_SHA=$BUILD_ID
RUN npm test && npm run build:client && npm run build:server

FROM node:22-slim
WORKDIR /app
ARG BUILD_ID=local
ENV NODE_ENV=production PORT=8080 DIST_DIR=/app/dist ASSETS_DIR=/app/dist/assets DATA_DIR=/data BUILD_ID=$BUILD_ID
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/main.js"]
