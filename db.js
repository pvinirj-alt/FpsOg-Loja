'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const FINISHED = "('delivered','cancelled','expired')";

/**
 * Banco de pedidos do bot. Guarda só o pedido e o ID da licença,
 * nunca a key em si (o seu server.py também só guarda o hash).
 * Todas as transições de status são condicionais (UPDATE ... WHERE status=...),
 * então clique duplo, dois staffs aprovando ao mesmo tempo etc. nunca entregam duas keys.
 */
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT    NOT NULL,
      user_tag        TEXT    NOT NULL,
      plan            TEXT    NOT NULL,
      price_cents     INTEGER NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending',
      channel_id      TEXT,
      message_id      TEXT,
      channel_deleted INTEGER NOT NULL DEFAULT 0,
      license_id      INTEGER,
      approved_by     TEXT,
      created_at      INTEGER NOT NULL,
      paid_at         INTEGER,
      finished_at     INTEGER,
      delete_at       INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_user
      ON orders(user_id) WHERE status IN ('pending','delivering');
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
  `);

  const st = {
    insert: db.prepare(
      'INSERT INTO orders(user_id,user_tag,plan,price_cents,created_at) VALUES(?,?,?,?,?)',
    ),
    get: db.prepare('SELECT * FROM orders WHERE id=?'),
    openByUser: db.prepare("SELECT * FROM orders WHERE user_id=? AND status IN ('pending','delivering')"),
    setChannel: db.prepare('UPDATE orders SET channel_id=?, message_id=? WHERE id=?'),
    claim: db.prepare("UPDATE orders SET status='delivering' WHERE id=? AND status='pending'"),
    release: db.prepare("UPDATE orders SET status='pending' WHERE id=? AND status='delivering'"),
    deliver: db.prepare(
      `UPDATE orders SET status='delivered', license_id=?, approved_by=?, paid_at=?, finished_at=?, delete_at=?
       WHERE id=? AND status='delivering'`,
    ),
    cancel: db.prepare(
      "UPDATE orders SET status=?, finished_at=?, delete_at=? WHERE id=? AND status='pending'",
    ),
    expirable: db.prepare("SELECT * FROM orders WHERE status='pending' AND created_at<=?"),
    due: db.prepare(
      `SELECT * FROM orders WHERE status IN ${FINISHED} AND channel_id IS NOT NULL
       AND channel_deleted=0 AND delete_at IS NOT NULL AND delete_at<=?`,
    ),
    channelDeleted: db.prepare('UPDATE orders SET channel_deleted=1 WHERE id=?'),
    recover: db.prepare("UPDATE orders SET status='pending' WHERE status='delivering'"),
    recent: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?'),
    recentByStatus: db.prepare('SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT ?'),
  };

  return {
    raw: db,
    close: () => db.close(),

    createOrder({ userId, userTag, plan, priceCents, now }) {
      const info = st.insert.run(userId, userTag, plan, priceCents, now);
      return Number(info.lastInsertRowid);
    },
    getOrder: (id) => st.get.get(id) || null,
    getOpenOrderByUser: (userId) => st.openByUser.get(userId) || null,
    setChannel: (id, channelId, messageId) => st.setChannel.run(channelId, messageId, id),

    /** pending -> delivering. Só UM chamador consegue (retorna true). */
    claimForDelivery: (id) => st.claim.run(id).changes === 1,
    /** delivering -> pending (falhou ao emitir a key, pode tentar de novo). */
    releaseClaim: (id) => st.release.run(id).changes === 1,
    markDelivered(id, { licenseId, approvedBy, now, deleteAt }) {
      return st.deliver.run(licenseId, String(approvedBy), now, now, deleteAt, id).changes === 1;
    },
    /** pending -> cancelled | expired. */
    cancel: (id, status, now, deleteAt) => st.cancel.run(status, now, deleteAt, id).changes === 1,

    expirablePending: (createdBefore) => st.expirable.all(createdBefore),
    dueForDeletion: (now) => st.due.all(now),
    markChannelDeleted: (id) => st.channelDeleted.run(id),

    /** Pedidos que ficaram "delivering" por queda do bot voltam para pending. */
    recoverStuck: () => st.recover.run().changes,

    listRecent: (limit, status) => (status ? st.recentByStatus.all(status, limit) : st.recent.all(limit)),
  };
}

module.exports = { openDb };
