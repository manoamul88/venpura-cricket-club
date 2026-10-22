FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    VENPURA_DATA_FILE=/app/data/venpura.json

WORKDIR /app

COPY --chown=node:node package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev
COPY --chown=node:node public ./public

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
