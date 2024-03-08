FROM node:20-slim
FROM mcr.microsoft.com/playwright:v1.42.1-jammy

RUN groupadd --gid 1001 app \
  && useradd --uid 1001 --gid app --shell /bin/bash --create-home app

WORKDIR /home/app

COPY --chown=app:app . .

RUN touch .env
RUN npm ci
RUN npm run prestart

USER app

ENTRYPOINT ["node"]

CMD ["--env-file=.env", "server/server.js"]