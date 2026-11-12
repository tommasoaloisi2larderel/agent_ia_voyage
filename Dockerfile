FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY data ./data
COPY scripts ./scripts
RUN mkdir -p /app/.cache && chown node:node /app/.cache
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
