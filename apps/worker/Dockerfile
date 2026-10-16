FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database packages/database
COPY packages/realtime-protocol packages/realtime-protocol
RUN pnpm install --frozen-lockfile --filter @yuzu/worker...
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm db:generate
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/src apps/web/src
COPY apps/worker/src apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
USER node
WORKDIR /app/apps/web
CMD ["pnpm", "exec", "tsx", "--tsconfig", "tsconfig.json", "../worker/src/index.ts"]
