'use strict';

// `id` PRECISA ser igual ao plano do seu server.py: 1d, 3d, 7d, 30d, lifetime.
// Preços em centavos. Ajuste à vontade (ordem = ordem no menu).
const PLANS = [
  { id: '1d', label: 'Diário', duration: '1 dia', priceCents: 500 },
  { id: '3d', label: '3 Dias', duration: '3 dias', priceCents: 1000 },
  { id: '7d', label: 'Semanal', duration: '7 dias', priceCents: 1490 },
  { id: '30d', label: 'Mensal', duration: '30 dias', priceCents: 2490 },
  { id: 'lifetime', label: 'Lifetime', duration: 'Vitalício', priceCents: 9900 },
];

const PLAN_IDS = PLANS.map((p) => p.id);

function getPlan(id) {
  return PLANS.find((p) => p.id === id) || null;
}

function formatBRL(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

module.exports = { PLANS, PLAN_IDS, getPlan, formatBRL };
