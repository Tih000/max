FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY prisma ./prisma

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install

RUN npm run prisma:generate

COPY src ./src
RUN npm run build

RUN mkdir -p /app/assets && \
    if [ -f /app/src/start_photo.png ]; then \
      cp /app/src/start_photo.png /app/assets/start_photo.png; \
    else \
      touch /app/assets/.placeholder; \
    fi

FROM node:20-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY --from=builder /app/prisma ./prisma

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/assets /app/certs

COPY --from=builder /app/assets/ /app/assets/

RUN npm install -g prisma@^6.19.0

RUN echo '#!/bin/sh\nset -e\necho "Выполняю миграции БД..."\nnpx prisma migrate deploy\necho "Регенерирую Prisma клиент после миграций..."\nnpx prisma generate\necho "Миграции выполнены. Запускаю бота..."\nexec node dist/index.js' > /app/start.sh && \
    chmod +x /app/start.sh

CMD ["/app/start.sh"]

