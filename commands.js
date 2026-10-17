'use strict';
const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { PLANS } = require('./plans');

const planChoices = PLANS.map((p) => ({ name: `${p.label} (${p.duration})`, value: p.id }));

// Visíveis só para quem tem "Gerenciar Servidor"; dentro do bot também checamos o cargo da equipe.
const staffOnly = PermissionFlagsBits.ManageGuild;

const definitions = [
  new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Envia o painel de vendas neste canal')
    .setDefaultMemberPermissions(staffOnly),

  new SlashCommandBuilder()
    .setName('pedidos')
    .setDescription('Lista os últimos pedidos')
    .setDefaultMemberPermissions(staffOnly)
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('Filtrar por status')
        .addChoices(
          { name: 'Aguardando pagamento', value: 'pending' },
          { name: 'Entregues', value: 'delivered' },
          { name: 'Cancelados', value: 'cancelled' },
          { name: 'Expirados', value: 'expired' },
        ),
    ),

  new SlashCommandBuilder()
    .setName('gerar')
    .setDescription('Gera uma key manualmente (suporte, sorteio, teste)')
    .setDefaultMemberPermissions(staffOnly)
    .addStringOption((o) =>
      o.setName('plano').setDescription('Plano da key').setRequired(true).addChoices(...planChoices),
    ),

  new SlashCommandBuilder()
    .setName('revogar')
    .setDescription('Revoga uma licença pelo ID (aparece no log da venda e em /pedidos)')
    .setDefaultMemberPermissions(staffOnly)
    .addIntegerOption((o) =>
      o.setName('id').setDescription('ID da licença').setRequired(true).setMinValue(1),
    ),
].map((c) => c.toJSON());

module.exports = { definitions };
