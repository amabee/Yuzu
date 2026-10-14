FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/realtime/package.json apps/realtime/package.json
COPY packages/realtime-protocol packages/realtime-protocol
RUN pnpm install --prod --frozen-lockfile --filter @yuzu/realtime...
COPY apps/realtime/server.mjs apps/realtime/server.mjs
USER node
WORKDIR /app/apps/realtime
EXPOSE 3001
CMD ["node", "server.mjs"]
