# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production (Puppeteer 최적화)
FROM node:20-alpine AS runner
WORKDIR /app

# Puppeteer 실행을 위한 필수 시스템 라이브러리 및 한글 폰트 설치
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto-cjk

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist

# Render 포트 바인딩
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
