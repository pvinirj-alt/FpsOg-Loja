'use strict';
const path = require('node:path');

// Carrega o .env da raiz do projeto (Node 20.12+).
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const env = process.env;

function required(name) {
  const value = (env[name] || '').trim();
  if (!value) throw new Error(`Variável ${name} está vazia ou ausente no .env`);
  return value;
}

function optional(name, fallback = '') {
  const value = (env[name] || '').trim();
  return value || fallback;
}

/** A URL da API recebe o token no cabeçalho: exige HTTPS (exceto localhost para testes). */
function apiUrl(name) {
  const raw = optional(name);
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} não é uma URL válida (use algo como https://seu-app.up.railway.app)`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${name} precisa começar com https:// (o token é enviado nessa conexão)`);
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function number(name, fallback) {
  const raw = optional(name);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} precisa ser um número positivo`);
  return n;
}

function licenseConfig() {
  const url = apiUrl('LICENSE_API_URL');
  if (url) {
    return { apiUrl: url, apiToken: required('LICENSE_API_TOKEN') };
  }
  return {
    apiUrl: '',
    python: optional('LICENSE_PYTHON', 'python3'),
    script: required('LICENSE_SCRIPT'),
    db: required('LICENSE_DB'),
  };
}

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: required('GUILD_ID'),
  staffRoleId: required('STAFF_ROLE_ID'),
  ticketCategoryId: optional('TICKET_CATEGORY_ID'),
  logChannelId: optional('LOG_CHANNEL_ID'),
  customerRoleId: optional('CUSTOMER_ROLE_ID'),

  productName: optional('PRODUCT_NAME', 'Produto'),
  panelImageUrl: optional('PANEL_IMAGE_URL'),
  pix: {
    key: optional('PIX_KEY'),
    keyType: optional('PIX_KEY_TYPE', 'Chave'),
    name: optional('PIX_NAME'),
  },
  orderTtlMinutes: number('ORDER_TTL_MINUTES', 30),
  closeDelayMinutes: number('CLOSE_DELAY_MINUTES', 10),

  // Modo API (gerador hospedado): LICENSE_API_URL + LICENSE_API_TOKEN.
  // Modo local (server.py na mesma máquina): LICENSE_PYTHON + LICENSE_SCRIPT + LICENSE_DB.
  license: licenseConfig(),

  dbFile: optional('BOT_DB', path.join(__dirname, '..', 'data', 'bot.sqlite3')),
};
