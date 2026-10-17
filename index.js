'use strict';
const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const cfg = require('./config');
const { openDb } = require('./db');
const { createLicense } = require('./license');
const { createBot } = require('./bot');
const { definitions } = require('./commands');

const db = openDb(cfg.dbFile);
const license = createLicense(cfg.license);
const client = new Client({ intents: [GatewayIntentBits.Guilds] }); // sem intents privilegiadas
const bot = createBot({ client, cfg, db, license });

// Diagnóstico: mostra só o TAMANHO do token (nunca o valor).
if (cfg.license.apiUrl) {
  console.log(`Gerador de keys: API ${cfg.license.apiUrl} (LICENSE_API_TOKEN com ${cfg.license.apiToken.length} caracteres)`);
} else {
  console.log('Gerador de keys: modo local (server.py)');
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot online como ${c.user.tag}`);

  const recovered = db.recoverStuck();
  if (recovered) console.log(`${recovered} pedido(s) que estavam sendo entregues voltaram para "pendente".`);

  try {
    const guild = await c.guilds.fetch(cfg.guildId);
    await guild.commands.set(definitions);
    console.log('Comandos registrados: /painel /pedidos /gerar /revogar');
  } catch (err) {
    console.error('Falha ao registrar comandos (o bot está no servidor certo? GUILD_ID correto?)', err);
  }

  setInterval(() => bot.sweep(), 30_000);
  bot.sweep();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await bot.handleInteraction(interaction);
  } catch (err) {
    console.error('Erro ao tratar interação:', err);
    const payload = { content: 'Ocorreu um erro. Tente novamente ou chame a equipe.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else if (interaction.isRepliable()) await interaction.reply(payload);
    } catch {
      /* interação expirada */
    }
  }
});

process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

client.login(cfg.token);
