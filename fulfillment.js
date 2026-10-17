'use strict';

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * ÚNICO ponto que transforma um pedido pago em key entregue.
 * Hoje é chamado pelo botão "Aprovar pagamento"; no futuro o webhook do
 * gateway (Mercado Pago etc.) chama exatamente esta função.
 *
 * Retorna { ok:true, order, key, licenseId }
 *      ou { ok:false, reason:'not_found'|'not_pending'|'issue_failed', order?, error? }
 */
async function fulfill({ db, license, orderId, approvedBy, closeDelaySec, now = nowSec() }) {
  const order = db.getOrder(orderId);
  if (!order) return { ok: false, reason: 'not_found' };

  // Só um chamador passa daqui; os demais recebem not_pending.
  if (!db.claimForDelivery(orderId)) return { ok: false, reason: 'not_pending', order };

  let issued;
  try {
    issued = await license.issueKey(order.plan);
    if (issued.plan !== order.plan) throw new Error('Plano da key diferente do pedido');
  } catch (error) {
    db.releaseClaim(orderId); // nada foi entregue; a equipe pode tentar de novo
    return { ok: false, reason: 'issue_failed', order, error };
  }

  db.markDelivered(orderId, {
    licenseId: issued.id,
    approvedBy,
    now,
    deleteAt: now + closeDelaySec,
  });
  return { ok: true, order: db.getOrder(orderId), key: issued.key, licenseId: issued.id };
}

module.exports = { fulfill, nowSec };
