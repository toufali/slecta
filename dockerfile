FROM node:20-alpine

WORKDIR /app

COPY . ./

RUN npm install

RUN echo "WORKSPACE=$WORKSPACE" >> .env

CMD [ "npm", "start" ]
