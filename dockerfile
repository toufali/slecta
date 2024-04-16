FROM node:20-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/ms-playwright

WORKDIR /home/node

COPY --chown=node:node ./package*.json ./
COPY --chown=node:node ./server ./server
COPY --chown=node:node ./client ./client
COPY --chown=node:node ./scripts ./scripts

RUN touch .env
RUN npm ci
RUN npx playwright install firefox --with-deps
RUN npm run prestart

USER node

ENTRYPOINT ["node"]

CMD ["--env-file=.env", "server/server.js"]