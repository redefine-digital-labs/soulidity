FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY services/walrus-uploader/package.json ./services/walrus-uploader/package.json
COPY services/walrus-uploader/package-lock.json ./services/walrus-uploader/package-lock.json
WORKDIR /app/services/walrus-uploader
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/services/walrus-uploader/node_modules ./services/walrus-uploader/node_modules
COPY package.json ./package.json
COPY src/shared ./src/shared
COPY services/walrus-uploader ./services/walrus-uploader
WORKDIR /app/services/walrus-uploader
RUN npm run build
RUN node -e "import('./dist/services/walrus-uploader/src/handler.js').then(() => console.log('walrus-uploader runtime import ok'))"

FROM node:22-bookworm-slim
WORKDIR /app/services/walrus-uploader
ENV NODE_ENV=production
COPY --from=build /app/services/walrus-uploader/package.json ./package.json
COPY --from=build /app/services/walrus-uploader/node_modules ./node_modules
COPY --from=build /app/services/walrus-uploader/dist ./dist
EXPOSE 8080
CMD ["node", "dist/services/walrus-uploader/src/server.js"]
