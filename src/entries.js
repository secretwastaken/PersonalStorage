import { EmbedBuilder } from 'discord.js';
import { KINDS, missingRequired, parseFields } from './kinds.js';
import * as store from './store.js';
import { COLORS } from './text.js';
import { EPHEMERAL, answers, excerpt, form, say, storageFor, warmCache } from './ui.js';
import { applyAmount } from './when.js';

// The commands and forms shared by every kind of entry: add, edit, remove
// and list. Each entry is a message in the person's channel; the database
// only remembers which message carries which number.

function slashValues(interaction, kind) {
  const values = {};
  for (const field of kind.fields) {
    if (field.type === 'file') values[field.id] = interaction.options.getAttachment(field.id) ?? undefined;
    else if (field.type === 'integer') values[field.id] = interaction.options.getInteger(field.id) ?? undefined;
    else values[field.id] = interaction.options.getString(field.id) ?? undefined;
  }
  return values;
}

const saved = (kind, number, message) => `${kind.emoji} ${kind.Noun} #${number} saved in <#${message.channelId}>. ${message.url}`;

async function post(interaction, found, kind, data) {
  const channel = found.channels[kind.channel];
  const number = store.nextNumber(interaction.guildId, interaction.user.id, kind.id);
  const message = await channel.send(kind.payload(data, number));
  store.addEntry({ guildId: interaction.guildId, userId: interaction.user.id, kind: kind.id, number, channelId: channel.id, messageId: message.id });
  return { number, message };
}

export function newForm(kind, values = {}) {
  return form(`ps:new:${kind.id}`, `New ${kind.noun}`, kind.fields, values);
}

export async function add(interaction, kind) {
  const values = slashValues(interaction, kind);
  // Anything long, or a required field left out, goes to a form, which has
  // room for several lines.
  if (missingRequired(kind, values).length) {
    const found = await storageFor(interaction, kind.channel);
    if (!found) return;
    await interaction.showModal(newForm(kind, values));
    return;
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  const found = await storageFor(interaction, kind.channel);
  if (!found) return;
  const parsed = parseFields(kind, values);
  if (parsed.error) return say(interaction, parsed.error);
  const { number, message } = await post(interaction, found, kind, parsed.data);
  await say(interaction, saved(kind, number, message));
}

export async function submitNew(interaction, kind) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const found = await storageFor(interaction, kind.channel);
  if (!found) return;
  const parsed = parseFields(kind, answers(interaction, kind.fields));
  if (parsed.error) return say(interaction, parsed.error);
  try {
    const { number, message } = await post(interaction, found, kind, parsed.data);
    await say(interaction, saved(kind, number, message));
  } catch (error) {
    // 40005 is Discord's "too large" for uploads.
    if (error.code === 40005) return say(interaction, 'That picture is too big for this server’s upload limit.');
    throw error;
  }
}

/** The entry's row and its message, or null after telling the person why not. */
async function locate(interaction, kind, number) {
  const row = store.entry(interaction.guildId, interaction.user.id, kind.id, number);
  if (!row) {
    await say(interaction, `You have no ${kind.noun} #${number}. \`/${kind.id} list\` shows the ones you have.`);
    return null;
  }
  const channel = interaction.guild.channels.cache.get(row.channel_id);
  const message = channel ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
  if (!message) {
    store.removeEntry(row.id);
    await say(interaction, `${kind.Noun} #${number} was deleted by hand, so there is nothing left to change.`);
    return null;
  }
  return { row, message };
}

export async function edit(interaction, kind) {
  const number = interaction.options.getInteger(kind.noun, true);
  const found = await locate(interaction, kind, number);
  if (!found) return;
  const fields = kind.fields.filter((field) => field.type !== 'file');
  await interaction.showModal(form(`ps:edit:${kind.id}:${number}`, `Edit ${kind.noun} #${number}`, fields, kind.read(found.message)));
}

export async function submitEdit(interaction, kind, number) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const found = await locate(interaction, kind, number);
  if (!found) return;
  const fields = kind.fields.filter((field) => field.type !== 'file');
  const parsed = parseFields(kind, answers(interaction, fields), kind.read(found.message));
  if (parsed.error) return say(interaction, parsed.error);
  await found.message.edit(kind.payload(parsed.data, number));
  await say(interaction, `${kind.emoji} ${kind.Noun} #${number} updated. ${found.message.url}`);
}

export async function remove(interaction, kind) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const number = interaction.options.getInteger(kind.noun, true);
  const found = await locate(interaction, kind, number);
  if (!found) return;
  const label = kind.label(kind.read(found.message));
  await found.message.delete();
  store.removeEntry(found.row.id);
  await say(interaction, `${kind.emoji} Removed ${kind.noun} #${number} (${label}).`);
}

export async function amount(interaction) {
  const kind = KINDS.item;
  await interaction.deferReply({ flags: EPHEMERAL });
  const number = interaction.options.getInteger('item', true);
  const change = interaction.options.getString('change', true);
  const found = await locate(interaction, kind, number);
  if (!found) return;
  const data = kind.read(found.message);
  const quantity = applyAmount(data.quantity, change);
  if (quantity === null) return say(interaction, 'Write a number to set the amount (12), or add or take some away (+3, -2).');
  await found.message.edit(kind.payload({ ...data, quantity }, number));
  await say(interaction, `🎒 ${data.name}: ×${data.quantity} → ×${quantity}. ${found.message.url}`);
}

/** Every entry of a kind with a label read from its message, newest first. */
export async function labelled(guild, userId, kind) {
  const rows = store.entries(guild.id, userId, kind.id);
  const channelId = store.channels(guild.id, userId)[kind.channel];
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  await warmCache(channel, rows);
  return rows.map((row) => {
    const message = channel?.messages.cache.get(row.message_id);
    return { row, label: message ? kind.label(kind.read(message)) : `${kind.Noun} #${row.number}`, url: message?.url ?? null };
  });
}

export async function list(interaction, kind) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const found = await storageFor(interaction, kind.channel);
  if (!found) return;
  const items = await labelled(interaction.guild, interaction.user.id, kind);
  const channel = found.channels[kind.channel];
  if (!items.length) return say(interaction, `${kind.emoji} Nothing in <#${channel.id}> yet. \`/${kind.id} add\` saves the first one.`);
  const shown = items.slice(0, 25);
  const lines = shown.map(({ row, label, url }) => `**#${row.number}** ${url ? `[${excerpt(label, 70)}](${url})` : excerpt(label, 70)}`);
  if (items.length > shown.length) lines.push(`…and ${items.length - shown.length} more in <#${channel.id}>.`);
  const embed = new EmbedBuilder().setColor(COLORS.panel).setTitle(`${kind.emoji} Your ${kind.id === 'journal' ? 'journal' : `${kind.noun}s`}`).setDescription(lines.join('\n'));
  await say(interaction, { embeds: [embed] });
}

export async function autocomplete(interaction, kind) {
  const typed = String(interaction.options.getFocused() ?? '').toLowerCase().trim();
  const items = await labelled(interaction.guild, interaction.user.id, kind);
  const choices = items
    .filter(({ row, label }) => !typed || String(row.number).startsWith(typed.replace('#', '')) || label.toLowerCase().includes(typed))
    .slice(0, 25)
    .map(({ row, label }) => ({ name: `#${row.number} · ${label}`.slice(0, 100), value: row.number }));
  await interaction.respond(choices);
}
