# pen: a self-contained image. Books, the lock and Construct's own state
# all live in the /data volume; /cache holds what pen can make again (the
# dictionary, grammar results): mount a volume there to keep it across upgrades.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN PEN_STANDALONE=1 npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PEN_DIR=/data \
    PEN_CACHE_DIR=/cache \
    PEN_INTERNAL_URL=http://127.0.0.1:3000 \
    PEN_CONSTRUCT_CLAUDE=claude-agent-acp \
    CLAUDE_CONFIG_DIR=/data/.claude \
    NEXT_TELEMETRY_DISABLED=1

# Construct's agent, pinned to the version pen is tested with.
RUN npm install -g @agentclientprotocol/claude-agent-acp@0.84.0 && npm cache clean --force

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p /data /cache && chown node:node /data /cache
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
