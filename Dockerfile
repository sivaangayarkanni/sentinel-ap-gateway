FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

# Copy manifests first so Docker caches the dependency layer
COPY package*.json ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi && npm cache clean --force

# Copy application code with non-root ownership
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public

USER node

# Placeholder — update if server/config.js uses a different default port
EXPOSE 3000

# Running node directly (rather than via npm) ensures SIGTERM reaches the process cleanly
CMD ["node", "server/index.js"]
