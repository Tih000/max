FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY certs ./certs

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN npm install
RUN npm run prisma:generate

COPY src ./src

RUN npm run build

FROM node:20-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY certs ./certs

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN npm install --omit=dev
RUN npm run prisma:generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/start_photo.png ./src/start_photo.png

CMD ["node", "dist/index.js"]

