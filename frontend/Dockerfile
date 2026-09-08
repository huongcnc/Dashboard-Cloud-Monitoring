FROM node:lts-alpine
ENV NODE_ENV=production
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --production --silent && mv node_modules ../
COPY . .
EXPOSE 3000
RUN chown -R node /usr/src/app
USER node
CMD ["npm", "start"]
