# syntax=docker/dockerfile:1

# Next.js 16 standalone build. Prisma 7 runs through the pg driver adapter,
# so there is no Rust query engine to match to the base image at runtime.

ARG NODE_IMAGE=node:22-alpine

# ---- deps: install everything needed to build ----------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: prisma generate + next build ------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* is inlined into the client bundle at build time, so the Maps
# key has to be present now — it is not a runtime secret. Pass it with
# `docker build --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...`.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}

RUN npm run build

# ---- migrator: one-off `prisma migrate deploy` (used by the CI pipeline) --
# Keeps the full toolchain so migrations run with a command override on the
# same build, e.g. `docker run --entrypoint sh ... -c "npx prisma migrate deploy"`
# or an ECS task that targets this stage.
FROM builder AS migrator
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runner: lean production image -------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# `output: "standalone"` ships a traced node_modules and a minimal server.js;
# static assets and public/ are copied in separately per the Next.js docs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# `public/` is currently empty (kept by .gitkeep) — the app's icon is an
# app-dir metadata file, not a static asset. server.js still serves anything
# dropped here later.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Insurance: the generated Prisma client, in case file tracing missed it.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
