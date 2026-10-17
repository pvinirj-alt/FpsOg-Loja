FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY *.js ./
CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
