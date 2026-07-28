FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY services ./services
RUN npm ci
ARG GIT_SHA=0.0.0-placeholder
# Version replacement must happen here, before dist leaves the builder stage:
# Vite content-hashes filenames during build, and a later sed would change bytes
# behind an unchanged hash, leaving CDNs serving stale bundles forever.
RUN cd apps/pwa && npx vite build && \
    grep -rl '0.0.0-placeholder' dist | xargs -r sed -i "s/0\.0\.0-placeholder/${GIT_SHA}/g"

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY apps/pwa/package.json ./apps/pwa/package.json
RUN npm ci --omit=dev
COPY --from=builder /app/apps/pwa/dist ./public
ENV STATIC_DIR=./public
ENV PORT=3000
EXPOSE 3000
CMD ["npx", "tsx", "services/api/src/main.ts"]
