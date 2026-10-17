'use strict';
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require('discord.js');
const { PLANS, getPlan, formatBRL } = require('./plans');
const { fulfill, nowSec } = require('./fulfillment');
const { FEATURES } = require('./product');

const EPHEMERAL = MessageFlags.Ephemeral;
// Preto. (0x000000 puro o Discord trata como "sem cor", por isso 0x010101.)
const BLACK = 0x010101;
const COLOR = { main: BLACK, ok: BLACK, warn: BLACK, off: BLACK };
const CANCEL_DELETE_SEC = 5;
const EXPIRED_DELETE_SEC = 60;

const STATUS_LABEL = {
  pending: 'aguardando',
  delivering: 'entregando',
  delivered: 'entregue',
  cancelled: 'cancelado',
  expired: 'expirado',
};

function createBot({ client, cfg, db, license }) {
  /* ───────────── helpers ───────────── */

  const isStaff = (member) =>
    Boolean(
      member &&
        (member.permissions?.has(PermissionFlagsBits.Administrator) ||
          member.roles?.cache?.has(cfg.staffRoleId)),
    );

  const fmtPlan = (order) => {
    const plan = getPlan(order.plan);
    return plan ? `${cfg.productName} — ${plan.label}` : order.plan;
  };

  async function fetchChannel(id) {
    if (!id) return null;
    try {
      return await client.channels.fetch(id);
    } catch {
      return null;
    }
  }

  async function sendLog(embed) {
    if (!cfg.logChannelId) return;
    try {
      const channel = await fetchChannel(cfg.logChannelId);
      await channel?.send({ embeds: [embed] });
    } catch (err) {
      console.warn('Não consegui escrever no canal de logs:', err.message);
    }
  }

  async function removeOrderButtons(order, channel) {
    if (!order.message_id) return;
    try {
      const ch = channel || (await fetchChannel(order.channel_id));
      const message = await ch?.messages.fetch(order.message_id);
      await message?.edit({ components: [] });
    } catch {
      /* mensagem já apagada — tudo bem */
    }
  }

  /* ───────────── mensagens ───────────── */

  function panelPayload() {
    const embed = new EmbedBuilder()
      .setColor(COLOR.main)
      .setTitle(`${cfg.productName}`)
      .setDescription(
        [
          FEATURES.map((f) => `**${f.title}**\n${f.items.map((i) => `• ${i}`).join('\n')}`).join('\n\n'),
          '',
          '**COMO COMPRAR**',
          '• Escolha o plano no menu abaixo',
          '• Um canal privado será criado só para você, pague via **Pix**',
          '• Após a aprovação, a **key chega no seu privado**',
          '',
          '> O tempo do plano só começa a contar quando você ativa a key pela primeira vez.',
        ].join('\n'),
      );
    if (cfg.panelImageUrl) embed.setImage(cfg.panelImageUrl);

    const menu = new StringSelectMenuBuilder()
      .setCustomId('buy:select')
      .setPlaceholder('Clique aqui para ver as opções')
      .addOptions(
        PLANS.map((p) => ({
          label: `${cfg.productName} - ${p.label}`.slice(0, 100),
          description: `Preço: ${formatBRL(p.priceCents)} | Duração: ${p.duration}`.slice(0, 100),
          value: p.id,
        })),
      );

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
  }

  function orderPayload(order, plan) {
    const expiresAt = order.created_at + cfg.orderTtlMinutes * 60;
    const pix = cfg.pix.key
      ? [
          `**Chave Pix (${cfg.pix.keyType}):**`,
          '```',
          cfg.pix.key,
          '```',
          cfg.pix.name ? `**Favorecido:** ${cfg.pix.name}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '_Chave Pix ainda não configurada — aguarde a equipe enviar os dados de pagamento._';

    const embed = new EmbedBuilder()
      .setColor(COLOR.main)
      .setTitle(`Pedido #${order.id}`)
      .addFields(
        { name: 'Produto', value: `${cfg.productName} — ${plan.label}`, inline: true },
        { name: 'Duração', value: plan.duration, inline: true },
        { name: 'Valor', value: `**${formatBRL(order.price_cents)}**`, inline: true },
        { name: 'Pagamento via Pix', value: pix },
        {
          name: 'Como funciona',
          value: [
            '1. Faça o Pix no **valor exato**.',
            '2. Envie o **comprovante** aqui neste canal.',
            '3. Aguarde a equipe aprovar — a key chega no seu **privado**.',
            '',
            `Este pedido expira <t:${expiresAt}:R>.`,
          ].join('\n'),
        },
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`order:approve:${order.id}`)
        .setLabel('Aprovar pagamento (equipe)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`order:cancel:${order.id}`)
        .setLabel('Cancelar pedido')
        .setStyle(ButtonStyle.Danger),
    );
    return { embeds: [embed], components: [row] };
  }

  function keyEmbed(order, key) {
    const plan = getPlan(order.plan);
    return new EmbedBuilder()
      .setColor(COLOR.ok)
      .setTitle(`Sua key — ${cfg.productName} ${plan?.label ?? ''}`.trim())
      .setDescription(['```', key, '```'].join('\n'))
      .addFields(
        { name: 'Pedido', value: `#${order.id}`, inline: true },
        { name: 'Duração', value: plan?.duration ?? '—', inline: true },
      )
      .setFooter({ text: 'O tempo do plano só começa a contar na primeira ativação. Não compartilhe sua key.' });
  }

  /* ───────────── criação do pedido ───────────── */

  async function onPlanSelected(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const resetPanel = () => interaction.message?.edit(panelPayload()).catch(() => {});

    const plan = getPlan(interaction.values[0]);
    if (!plan) {
      await interaction.editReply('Plano inválido. Tente novamente.');
      return resetPanel();
    }

    const existing = db.getOpenOrderByUser(interaction.user.id);
    if (existing) {
      const where = existing.channel_id ? `<#${existing.channel_id}>` : `o pedido #${existing.id}`;
      await interaction.editReply(`Você já tem um pedido em andamento: ${where}. Conclua ou cancele antes de abrir outro.`);
      return resetPanel();
    }

    const { guild, user } = interaction;
    const orderId = db.createOrder({
      userId: user.id,
      userTag: user.tag ?? user.username,
      plan: plan.id,
      priceCents: plan.priceCents,
      now: nowSec(),
    });

    let channel;
    try {
      const slug = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'cliente';
      const allow = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ];
      channel = await guild.channels.create({
        name: `pedido-${orderId}-${slug}`,
        type: ChannelType.GuildText,
        parent: cfg.ticketCategoryId || undefined,
        topic: `Pedido #${orderId} • ${user.tag ?? user.username} • ${plan.label}`,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow },
          { id: cfg.staffRoleId, allow: [...allow, PermissionFlagsBits.ManageMessages] },
          {
            id: client.user.id,
            allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
          },
        ],
      });

      const order = db.getOrder(orderId);
      const message = await channel.send({ content: `<@${user.id}>`, ...orderPayload(order, plan) });
      db.setChannel(orderId, channel.id, message.id);
      await interaction.editReply(`Pedido criado! Vá até ${channel} para pagar.`);
    } catch (err) {
      console.error(`Falha ao criar o pedido #${orderId}:`, err);
      db.cancel(orderId, 'cancelled', nowSec(), nowSec());
      await channel?.delete('Falha ao criar pedido').catch(() => {});
      await interaction.editReply(
        'Não consegui criar o canal do pedido. Avise a equipe (o bot precisa da permissão **Gerenciar Canais**).',
      );
    }
    return resetPanel();
  }

  /* ───────────── aprovação / entrega ───────────── */

  /** Entrega a key ao comprador. Usado pelo botão de aprovar (e, no futuro, pelo webhook do gateway). */
  async function deliverToBuyer({ order, key, licenseId, approvedBy }) {
    const channel = await fetchChannel(order.channel_id);
    await removeOrderButtons(order, channel);

    const embed = keyEmbed(order, key);
    let dmOk = false;
    try {
      const user = await client.users.fetch(order.user_id);
      await user.send({ embeds: [embed] });
      dmOk = true;
    } catch (err) {
      console.warn(`DM falhou para ${order.user_id} (pedido #${order.id}): ${err.message}`);
    }

    const closeMin = cfg.closeDelayMinutes;
    try {
      if (dmOk) {
        await channel?.send({
          content: `<@${order.user_id}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(COLOR.ok)
              .setTitle('Pagamento aprovado!')
              .setDescription(`Sua key foi enviada no seu **privado**. Este canal fecha em ${closeMin} min.`),
          ],
        });
      } else {
        await channel?.send({
          content: `<@${order.user_id}>`,
          embeds: [
            embed,
            new EmbedBuilder()
              .setColor(COLOR.warn)
              .setTitle('Seu privado está fechado')
              .setDescription(
                `Não consegui te enviar por DM, então a key está acima — **copie agora**. Este canal fecha em ${closeMin} min.`,
              ),
          ],
        });
      }
    } catch (err) {
      console.error(
        `ATENÇÃO: pedido #${order.id} (licença ${licenseId}) — falha ao avisar no canal. DM=${dmOk}. ` +
          `Se o cliente não recebeu, use /revogar ${licenseId} e /gerar.`,
        err,
      );
    }

    if (cfg.customerRoleId) {
      try {
        const member = await client.guilds.cache.get(cfg.guildId)?.members.fetch(order.user_id);
        await member?.roles.add(cfg.customerRoleId);
      } catch (err) {
        console.warn('Não consegui dar o cargo de cliente:', err.message);
      }
    }

    await sendLog(
      new EmbedBuilder()
        .setColor(COLOR.ok)
        .setTitle(`Venda #${order.id} entregue`)
        .addFields(
          { name: 'Cliente', value: `<@${order.user_id}> (${order.user_tag})`, inline: true },
          { name: 'Produto', value: fmtPlan(order), inline: true },
          { name: 'Valor', value: formatBRL(order.price_cents), inline: true },
          { name: 'ID da licença', value: String(licenseId), inline: true },
          { name: 'Aprovado por', value: approvedBy === 'gateway' ? 'Gateway' : `<@${approvedBy}>`, inline: true },
          { name: 'Entrega', value: dmOk ? 'DM' : 'canal (DM fechada)', inline: true },
        )
        .setTimestamp(),
    );
  }

  async function onApprove(interaction, orderId) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Só a equipe pode aprovar pagamentos.', flags: EPHEMERAL });
    }
    await interaction.deferReply({ flags: EPHEMERAL });

    const result = await fulfill({
      db,
      license,
      orderId,
      approvedBy: interaction.user.id,
      closeDelaySec: cfg.closeDelayMinutes * 60,
    });

    if (!result.ok) {
      if (result.reason === 'issue_failed') {
        console.error(`Falha ao emitir key do pedido #${orderId}:`, result.error);
        return interaction.editReply(
          'Não consegui gerar a key (o gerador não respondeu). O pedido continua pendente — tente aprovar de novo em instantes.',
        );
      }
      const status = result.order ? STATUS_LABEL[result.order.status] ?? result.order.status : '—';
      return interaction.editReply(`Esse pedido não pode mais ser aprovado (status: ${status}).`);
    }

    await deliverToBuyer({
      order: result.order,
      key: result.key,
      licenseId: result.licenseId,
      approvedBy: interaction.user.id,
    });
    return interaction.editReply(`Pedido #${orderId} aprovado e key entregue.`);
  }

  async function onCancel(interaction, orderId) {
    const order = db.getOrder(orderId);
    if (!order) return interaction.reply({ content: 'Pedido não encontrado.', flags: EPHEMERAL });
    if (interaction.user.id !== order.user_id && !isStaff(interaction.member)) {
      return interaction.reply({ content: 'Só o dono do pedido ou a equipe pode cancelar.', flags: EPHEMERAL });
    }

    const now = nowSec();
    if (!db.cancel(orderId, 'cancelled', now, now + CANCEL_DELETE_SEC)) {
      return interaction.reply({ content: 'Esse pedido já foi finalizado.', flags: EPHEMERAL });
    }
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR.off)
          .setTitle(`Pedido #${orderId} cancelado`)
          .setDescription('Este canal será fechado em instantes.'),
      ],
      components: [],
    });
    await sendLog(
      new EmbedBuilder()
        .setColor(COLOR.off)
        .setTitle(`Pedido #${orderId} cancelado`)
        .setDescription(`${fmtPlan(order)} • <@${order.user_id}> • por <@${interaction.user.id}>`),
    );
  }

  /* ───────────── comandos da equipe ───────────── */

  const staffGuard = (interaction) => {
    if (isStaff(interaction.member)) return true;
    interaction.reply({ content: 'Comando exclusivo da equipe.', flags: EPHEMERAL });
    return false;
  };

  async function cmdPainel(interaction) {
    if (!staffGuard(interaction)) return;
    await interaction.channel.send(panelPayload());
    await interaction.reply({ content: 'Painel enviado neste canal.', flags: EPHEMERAL });
  }

  async function cmdPedidos(interaction) {
    if (!staffGuard(interaction)) return;
    const rows = db.listRecent(15, interaction.options.getString('status'));
    const text = rows.length
      ? rows
          .map(
            (o) =>
              `**#${o.id}** • <@${o.user_id}> • ${fmtPlan(o)} • ${formatBRL(o.price_cents)} • ${
                STATUS_LABEL[o.status] ?? o.status
              }${o.license_id ? ` • licença \`${o.license_id}\`` : ''}`,
          )
          .join('\n')
      : 'Nenhum pedido encontrado.';
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLOR.main).setTitle('Últimos pedidos').setDescription(text)],
      flags: EPHEMERAL,
    });
  }

  async function cmdGerar(interaction) {
    if (!staffGuard(interaction)) return;
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const issued = await license.issueKey(interaction.options.getString('plano', true));
      await interaction.editReply({
        content: `Licença \`${issued.id}\` • plano **${issued.plan}**\n\`\`\`${issued.key}\`\`\``,
      });
      await sendLog(
        new EmbedBuilder()
          .setColor(COLOR.warn)
          .setTitle('Key gerada manualmente')
          .setDescription(`Plano **${issued.plan}** • licença \`${issued.id}\` • por <@${interaction.user.id}>`),
      );
    } catch (err) {
      console.error('/gerar falhou:', err);
      await interaction.editReply('Não consegui gerar a key. Veja o console do bot.');
    }
  }

  async function cmdRevogar(interaction) {
    if (!staffGuard(interaction)) return;
    await interaction.deferReply({ flags: EPHEMERAL });
    const id = interaction.options.getInteger('id', true);
    try {
      const done = await license.revokeLicense(id);
      await interaction.editReply(done ? `Licença \`${id}\` revogada.` : `Licença \`${id}\` não encontrada.`);
      if (done) {
        await sendLog(
          new EmbedBuilder()
            .setColor(COLOR.warn)
            .setTitle('Licença revogada')
            .setDescription(`Licença \`${id}\` • por <@${interaction.user.id}>`),
        );
      }
    } catch (err) {
      console.error('/revogar falhou:', err);
      await interaction.editReply('Não consegui revogar. Veja o console do bot.');
    }
  }

  /* ───────────── roteador ───────────── */

  async function handleInteraction(interaction) {
    if (interaction.guildId !== cfg.guildId) return;

    if (interaction.isChatInputCommand()) {
      const handlers = { painel: cmdPainel, pedidos: cmdPedidos, gerar: cmdGerar, revogar: cmdRevogar };
      return handlers[interaction.commandName]?.(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'buy:select') {
      return onPlanSelected(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith('order:')) {
      const [, action, rawId] = interaction.customId.split(':');
      const orderId = Number(rawId);
      if (!Number.isInteger(orderId)) return;
      if (action === 'approve') return onApprove(interaction, orderId);
      if (action === 'cancel') return onCancel(interaction, orderId);
    }
  }

  /* ───────────── manutenção periódica ───────────── */

  let sweeping = false;
  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      const now = nowSec();

      for (const order of db.expirablePending(now - cfg.orderTtlMinutes * 60)) {
        if (!db.cancel(order.id, 'expired', now, now + EXPIRED_DELETE_SEC)) continue;
        const channel = await fetchChannel(order.channel_id);
        await removeOrderButtons(order, channel);
        await channel
          ?.send({
            content: `<@${order.user_id}>`,
            embeds: [
              new EmbedBuilder()
                .setColor(COLOR.off)
                .setTitle(`Pedido #${order.id} expirado`)
                .setDescription('O prazo para pagamento acabou. Abra um novo pedido no painel quando quiser.'),
            ],
          })
          .catch(() => {});
        await sendLog(
          new EmbedBuilder()
            .setColor(COLOR.off)
            .setTitle(`Pedido #${order.id} expirou`)
            .setDescription(`${fmtPlan(order)} • <@${order.user_id}>`),
        );
      }

      for (const order of db.dueForDeletion(now)) {
        const channel = await fetchChannel(order.channel_id);
        try {
          await channel?.delete(`Pedido #${order.id} finalizado`);
        } catch (err) {
          console.warn(`Não consegui apagar o canal do pedido #${order.id}: ${err.message}`);
        }
        db.markChannelDeleted(order.id); // marca sempre, para não ficar tentando eternamente
      }
    } catch (err) {
      console.error('Erro na manutenção periódica:', err);
    } finally {
      sweeping = false;
    }
  }

  return { handleInteraction, sweep, panelPayload, deliverToBuyer };
}

module.exports = { createBot };
