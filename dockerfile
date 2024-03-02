# Build image
FROM node:20-slim
RUN npx -y playwright@1.42.0 install --with-deps

RUN mkdir -p /app
RUN chown node /app
USER node
WORKDIR /app

COPY package.json package.json
COPY package-lock.json package-lock.json
COPY .env.dist ./.env
COPY --chown=node:node . ./

RUN npm install

CMD ["npm", "start"]

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
