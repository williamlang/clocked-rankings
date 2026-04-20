FROM node:22-alpine

# better-sqlite3 needs build tools during install
RUN apk add --no-cache python3 make g++ tini

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Baseline copy — runtime bind-mount will overlay src/scripts for hot reload
COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3457

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
