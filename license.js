'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');
const { PLAN_IDS } = require('./plans');

function checkIssued(data, plan) {
  if (!data || typeof data.key !== 'string' || !Number.isInteger(data.id) || data.plan !== plan) {
    throw new Error('Resposta inesperada do gerador de keys');
  }
  return { id: data.id, plan: data.plan, key: data.key };
}

function checkPlan(plan) {
  if (!PLAN_IDS.includes(plan)) throw new Error(`Plano inválido: ${plan}`);
}

/**
 * Modo API (recomendado quando o gerador está hospedado, ex.: Railway).
 * O bot chama, por HTTPS, as rotas de administração do server.py:
 *   POST /admin/issue   corpo: o plano (ex. "7d")   -> JSON {id, plan, key}
 *   POST /admin/revoke  corpo: o ID da licença       -> "revoked" | 404
 * Autenticação: cabeçalho "Authorization: Bearer <LICENSE_API_TOKEN>".
 */
function createApiLicense({ apiUrl, apiToken }) {
  const base = apiUrl.replace(/\/+$/, '');

  async function post(route, body) {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
      body,
      redirect: 'error', // nunca seguir redirecionamento com o token no cabeçalho
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, text: await response.text() };
  }

  return {
    async issueKey(plan) {
      checkPlan(plan);
      const { status, text } = await post('/admin/issue', plan);
      if (status !== 200) throw new Error(`Gerador respondeu HTTP ${status}`);
      return checkIssued(JSON.parse(text), plan);
    },

    async revokeLicense(id) {
      if (!Number.isInteger(id) || id <= 0) throw new Error('ID inválido');
      const { status } = await post('/admin/revoke', String(id));
      if (status === 200) return true;
      if (status === 404) return false;
      throw new Error(`Gerador respondeu HTTP ${status}`);
    },
  };
}

/**
 * Modo local: roda `python server.py --db <banco> issue <plano>` na mesma máquina.
 */
function createCliLicense({ python, script, db }) {
  const [command, ...prefixArgs] = python.trim().split(/\s+/);

  function run(args) {
    return new Promise((resolve, reject) => {
      execFile(
        command,
        [...prefixArgs, script, '--db', db, ...args],
        { cwd: path.dirname(script), timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            error.stderr = String(stderr || '');
            return reject(error);
          }
          resolve(String(stdout));
        },
      );
    });
  }

  return {
    async issueKey(plan) {
      checkPlan(plan);
      const out = await run(['issue', plan]);
      return checkIssued(JSON.parse(out.trim().split('\n').pop()), plan);
    },

    async revokeLicense(id) {
      if (!Number.isInteger(id) || id <= 0) throw new Error('ID inválido');
      try {
        await run(['revoke', String(id)]);
        return true;
      } catch (err) {
        if (/license ID not found/i.test(err.stderr || '')) return false;
        throw err;
      }
    },
  };
}

/** Se LICENSE_API_URL estiver definida usa a API; senão usa o server.py local. */
function createLicense(options) {
  return options.apiUrl ? createApiLicense(options) : createCliLicense(options);
}

module.exports = { createLicense, createApiLicense, createCliLicense };
