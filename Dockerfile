
FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./

RUN npm install --omit=dev --no-audit --no-fund

# Copia os arquivos JavaScript
COPY *.js ./

# Copia o banner da FpsOg' External
COPY fpsog-external.png ./

CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
