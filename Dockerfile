# ---------- Build web ----------
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- Build backend ----------
FROM node:22-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# ---------- Runtime ----------
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh WEB_DIST=/app/web
WORKDIR /app/backend
COPY --from=api /app/backend/node_modules ./node_modules
COPY --from=api /app/backend/dist ./dist
COPY --from=api /app/backend/prisma ./prisma
COPY --from=api /app/backend/package.json ./
COPY --from=web /app/web/dist /app/web
EXPOSE 4000
# Áp migration rồi chạy server (seed tạo tài khoản admin nếu chưa có)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/scripts/seed.js && node dist/server.js"]
