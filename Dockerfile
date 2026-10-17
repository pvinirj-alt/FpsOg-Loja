# Node 22 | Bot de vendas no Railway (sem porta; é um worker)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
