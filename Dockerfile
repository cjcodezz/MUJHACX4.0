# Single-stage: this is a plain Node server with no build step, and the vision
# models are already vendored under public/models.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first so a code change does not re-install every layer.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

# The store writes here; mount a volume in production or conversations reset on
# every redeploy.
RUN mkdir -p data
VOLUME ["/app/data"]

EXPOSE 8091
ENV PORT=8091

# Fail the container if the vendors are unreachable, rather than serving a page
# that cannot answer anything.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8091)+'/api/health').then(r=>r.json()).then(d=>process.exit(d.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
