# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json tsconfig.base.json tsconfig.build.json ./
COPY src ./src
COPY webui ./webui

RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    BOT_CONFIG=/app/config/bot.config.jsonc \
    BOT_DATA_DIR=/app/data
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node LICENSE bot.config.example.jsonc ./

RUN mkdir -p /app/config /app/data /app/plugins \
    && chown -R node:node /app/config /app/data /app/plugins

USER node
EXPOSE 8787
ENTRYPOINT ["node", "dist/app.js"]
