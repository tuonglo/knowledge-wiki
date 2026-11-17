# Build context: repo root (see docker-compose.yml).
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @kw/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @kw/api build \
 && pnpm --filter @kw/api deploy --prod --legacy --ignore-scripts /out \
 && cp -r apps/api/dist /out/dist

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
