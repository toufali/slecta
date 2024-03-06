# # Build image
# FROM node:20 AS node-builder
# ARG APP_INSTALL_PATH=/home/node/app
# USER node
# RUN mkdir $APP_INSTALL_PATH
# WORKDIR $APP_INSTALL_PATH
# COPY --chown=node:node package*.json ./
# RUN npm install && npm ci
# COPY --chown=node:node . ./

# # Production image
# FROM node:20-slim
# ARG APP_INSTALL_PATH=/home/node/app
# USER node
# RUN mkdir $APP_INSTALL_PATH
# WORKDIR $APP_INSTALL_PATH
# COPY --chown=node:node --from=node-builder $APP_INSTALL_PATH ./
# CMD ["npm", "start"]


FROM node:20-slim
FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /home/node
COPY . .
RUN touch .env

# RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

# WORKDIR /home/node/app

# COPY --chown=node:node package*.json ./

RUN npm ci
# RUN PLAYWRIGHT_BROWSERS_PATH=0 npx playwright@1.42.1 install firefox --with-deps

# COPY --chown=node:node . .

# EXPOSE 8080

RUN groupadd --gid 1001 node \
  && useradd --uid 1001 --gid node --shell /bin/bash --create-home node

USER node

CMD [ "npm", "start" ]



# FROM node:20-slim
# FROM mcr.microsoft.com/playwright:v1.42.0

# RUN groupadd --gid 1000 node \
#   && useradd --uid 1000 --gid node --shell /bin/bash --create-home node

# # RUN npx -y playwright@1.42.0 install firefox --with-deps
# ARG APP_INSTALL_PATH=/home/node/app

# # RUN mkdir -p /app
# # RUN chown node /app
# USER node
# RUN mkdir $APP_INSTALL_PATH
# WORKDIR $APP_INSTALL_PATH
# COPY --chown=node:node package*.json ./
# COPY --chown=node:node .env.dist ./.env

# RUN npm install

# COPY --chown=node:node . ./

# CMD ["npm", "start"]

# # Build image
# FROM node:18 AS node-builder
# ARG APP_INSTALL_PATH=/home/node/oidc-proxy-microservice
# USER node
# RUN mkdir $APP_INSTALL_PATH
# WORKDIR $APP_INSTALL_PATH
# COPY --chown=node:node package*.json ./
# RUN npm install && npm ci
# COPY --chown=node:node . ./

# # Production image
# FROM node:18-slim
# ARG APP_INSTALL_PATH=/home/node/oidc-proxy-microservice
# USER node
# RUN mkdir $APP_INSTALL_PATH
# WORKDIR $APP_INSTALL_PATH
# COPY --chown=node:node --from=node-builder $APP_INSTALL_PATH ./
# CMD ["/usr/local/bin/node", "src/server/index.js"]






# FROM node:18.12-alpine

# RUN addgroup -g 10001 app && \
#     adduser -D -G app -h /app -u 10001 app
# RUN rm -rf /tmp/*

# WORKDIR /app

# USER app

# COPY package.json package.json
# COPY package-lock.json package-lock.json

# COPY --chown=app:app . /app

# RUN npm ci --audit=false && rm -rf ~app/.npm /tmp/*

# COPY .env-dist ./.env

# ARG SENTRY_RELEASE
# ENV SENTRY_RELEASE=$SENTRY_RELEASE

# CMD ["npm", "start"]
