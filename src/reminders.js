import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { config } from './config.js';
import * as store from './store.js';
import { COLORS } from './text.js';
import { EPHEMERAL, answers, excerpt, form, say, storageFor, warmCache } from './ui.js';
import { describeEvery, nextAfter, parseDuration, parseWhen, timestamp, validTimezone, wallClock, zoneLabel } from './when.js';

// A reminder is a message in the person's reminders channel. Its text is read
// from that message when it fires, so the database holds only the time.
// Deleting the message cancels the reminder.

const TICK_MS = 15_000;
const MAX_PENDING = 50;
const MIN_REPEAT_MS = 10 * 60_000;
const MAX_AHEAD_MS = 366 * 86_400_000;
export const MAX_TEXT = 1500;

export const zoneOf = (userId) => store.timezone(userId) ?? config.timezone;

// Players are spread over the server's zones, so a reminder spells its time
// out on each of their clocks as well as in Discord's own (the reader's).
export const clocks = (date) => config.timezones.map((zone) => `${zoneLabel(zone)}: ${wallClock(date, zone)}`).join(' · ');

const embedOf = (message) => message?.embeds?.[0]?.data ?? message?.embeds?.[0] ?? {};
export const textOf = (message) => embedOf(message).description ?? '';

export function reminderEmbed(row, text, sentAt = null) {
  const embed = new EmbedBuilder().setTitle(`⏰ Reminder #${row.number}`).setDescription(text);
  if (row.status === 'pending') {
    embed.setColor(COLORS.reminder).addFields({ name: 'When', value: `${timestamp(row.due_at, 'F')} (${timestamp(row.due_at, 'R')})\n${clocks(row.due_at)}` });
    if (row.every_ms) embed.addFields({ name: 'Repeats', value: describeEvery(row.every_ms), inline: true });
    if (row.dm) embed.addFields({ name: 'Also by DM', value: 'Yes', inline: true });
    embed.setFooter({ text: row.every_ms ? `/remind cancel ${row.number} stops it` : `/remind cancel ${row.number} cancels it` });
  } else if (row.status === 'done') {
    embed.setColor(COLORS.done).addFields({ name: 'Done', value: `Sent ${timestamp(sentAt ?? row.due_at, 'R')}` });
  } else {
    embed.setColor(COLORS.done).addFields({ name: 'Cancelled', value: 'This one will not ring.' });
  }
  return embed;
}

/** "1d", "every 2 days", "daily" as milliseconds; null when it is not a span. */
export function parseRepeat(text) {
  const raw = String(text ?? '').trim().toLowerCase().replace(/^every\s+/, '');
  const words = { hourly: '1h', daily: '1d', weekly: '1w', day: '1d', hour: '1h', week: '1w' };
  return parseDuration(words[raw] ?? raw);
}

/** Checks a reminder request. Returns { dueAt, everyMs } or { error }. */
export function plan({ when, repeat }, zone, now = new Date()) {
  const dueAt = parseWhen(when, zone, now);
  if (!dueAt) return { error: `I couldn’t read “${excerpt(when, 40)}” as a time. Try \`2h\`, \`30m\`, \`18:30\`, \`tomorrow 9:00\` or \`24/12 20:00\`.` };
  if (dueAt.getTime() <= now.getTime()) return { error: 'That time has already passed.' };
  if (dueAt.getTime() - now.getTime() > MAX_AHEAD_MS) return { error: 'Reminders can be set up to a year ahead.' };
  let everyMs = null;
  if (repeat && String(repeat).trim()) {
    everyMs = parseRepeat(repeat);
    if (!everyMs) return { error: `I couldn’t read “${excerpt(repeat, 40)}” as a repeat. Try \`1d\`, \`12h\` or \`1w\`.` };
    if (everyMs < MIN_REPEAT_MS) return { error: 'A reminder can’t repeat more often than every 10 minutes.' };
    if (everyMs > MAX_AHEAD_MS) return { error: 'A reminder can’t wait more than a year between repeats.' };
  }
  return { dueAt, everyMs };
}

const clockTime = (when) => !parseDuration(String(when ?? '').trim().toLowerCase().replace(/^in\s+/, ''));

async function create(interaction, { what, when, repeat, dm, zone: chosen = null }) {
  const found = await storageFor(interaction, 'reminders');
  if (!found) return;
  const text = String(what ?? '').trim().slice(0, MAX_TEXT);
  if (!text) return say(interaction, 'The reminder needs some words.');
  if (store.pendingReminders(interaction.guildId, interaction.user.id).length >= MAX_PENDING) return say(interaction, `You have ${MAX_PENDING} reminders waiting already. \`/remind cancel\` makes room.`);
  if (chosen && !validTimezone(chosen)) return say(interaction, `“${chosen}” isn’t a time zone I know.`);
  const zone = chosen || zoneOf(interaction.user.id);
  const planned = plan({ when, repeat }, zone);
  if (planned.error) return say(interaction, planned.error);

  const channel = found.channels.reminders;
  const number = store.nextNumber(interaction.guildId, interaction.user.id, 'reminder');
  const draft = { number, due_at: planned.dueAt.toISOString(), every_ms: planned.everyMs, dm: dm ? 1 : 0, status: 'pending' };
  const message = await channel.send({ embeds: [reminderEmbed(draft, text)] });
  store.addReminder({ guildId: interaction.guildId, userId: interaction.user.id, number, channelId: channel.id, messageId: message.id, dueAt: planned.dueAt, everyMs: planned.everyMs, dm });

  const lines = [`⏰ Reminder #${number} set for ${timestamp(planned.dueAt, 'F')} (${timestamp(planned.dueAt, 'R')}).${planned.everyMs ? ` It repeats ${describeEvery(planned.everyMs)}.` : ''} ${message.url}`, clocks(planned.dueAt)];
  if (clockTime(when) && !chosen && !store.timezone(interaction.user.id)) lines.push(`-# “${excerpt(when, 40)}” was read as ${zoneLabel(zone)} time. Pick your clock on your home panel or with \`/storage timezone\`, or set \`zone\` on the reminder.`);
  await say(interaction, lines.join('\n'));
}

export async function remindMe(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  await create(interaction, {
    what: interaction.options.getString('what', true),
    when: interaction.options.getString('when', true),
    repeat: interaction.options.getString('repeat'),
    dm: interaction.options.getBoolean('dm') ?? false,
    zone: interaction.options.getString('zone'),
  });
}

const option = (label, value, chosen) => new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setDefault(value === chosen);

/** The reminder form's fields. With more than one server zone it asks which clock the time is on, starting from the person's own. */
export function formFields(zone = config.timezone) {
  const fields = [
    { id: 'what', label: 'Remind me to…', type: 'paragraph', max: MAX_TEXT, required: true, placeholder: 'Refuel the generator' },
    { id: 'when', label: 'When', type: 'text', max: 40, required: true, placeholder: '2h, 30m, 18:30, tomorrow 9:00, 24/12 20:00' },
    { id: 'repeat', label: 'Repeat every (leave empty for once)', type: 'text', max: 20, placeholder: '1d, 12h, 1w' },
    {
      id: 'dm',
      label: 'Where should it ring?',
      type: 'select',
      build: () => new StringSelectMenuBuilder().setCustomId('dm').setMinValues(1).setMaxValues(1).addOptions(option('In my reminders channel', 'no', 'no'), option('In my reminders channel and by DM', 'yes', 'no')),
    },
  ];
  if (config.timezones.length > 1) {
    const own = config.timezones.includes(zone) ? zone : config.timezone;
    fields.push({
      id: 'zone',
      label: 'A clock time like 18:30 is in…',
      type: 'select',
      build: () => new StringSelectMenuBuilder().setCustomId('zone').setMinValues(1).setMaxValues(1).addOptions(config.timezones.map((each) => option(`${zoneLabel(each)} time`, each, own))),
    });
  }
  return fields;
}

export const reminderForm = (zone) => form('ps:new:reminder', 'New reminder', formFields(zone));

export async function submitForm(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const values = answers(interaction, formFields(zoneOf(interaction.user.id)));
  await create(interaction, { ...values, dm: values.dm === 'yes', zone: values.zone ?? null });
}

async function pendingWithText(guild, userId) {
  const rows = store.pendingReminders(guild.id, userId);
  const channelId = store.channels(guild.id, userId).reminders;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  await warmCache(channel, rows);
  return rows.map((row) => {
    const message = channel?.messages.cache.get(row.message_id);
    return { row, text: message ? textOf(message) : '', url: message?.url ?? null };
  });
}

export async function list(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const found = await storageFor(interaction, 'reminders');
  if (!found) return;
  const items = await pendingWithText(interaction.guild, interaction.user.id);
  if (!items.length) return say(interaction, '⏰ No reminders waiting. `/remind me` sets one.');
  const lines = items.slice(0, 25).map(({ row, text, url }) => `**#${row.number}** ${timestamp(row.due_at, 'R')}${row.every_ms ? ` · ${describeEvery(row.every_ms)}` : ''} · ${url ? `[${excerpt(text, 60) || 'reminder'}](${url})` : excerpt(text, 60)}`);
  if (items.length > 25) lines.push(`…and ${items.length - 25} more.`);
  await say(interaction, { embeds: [new EmbedBuilder().setColor(COLORS.reminder).setTitle('⏰ Your reminders').setDescription(lines.join('\n')).setFooter({ text: `Times are shown in your own clock. Reminders read “18:30” in ${zoneOf(interaction.user.id)}.` })] });
}

async function originalOf(client, row) {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  return channel ? channel.messages.fetch(row.message_id).catch(() => null) : null;
}

export async function cancel(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const number = interaction.options.getInteger('reminder', true);
  const row = store.reminder(interaction.guildId, interaction.user.id, number);
  if (!row || row.status !== 'pending') return say(interaction, `You have no reminder #${number} waiting. \`/remind list\` shows the ones you have.`);
  store.finishReminder(row.id, 'cancelled');
  const original = await originalOf(interaction.client, row);
  if (original) await original.edit({ embeds: [reminderEmbed(store.reminderById(row.id), textOf(original))] }).catch(() => {});
  await say(interaction, `⏰ Reminder #${number} cancelled.`);
}

export async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() ?? '').toLowerCase().trim();
  const items = await pendingWithText(interaction.guild, interaction.user.id);
  await interaction.respond(
    items
      .filter(({ row, text }) => !typed || String(row.number).startsWith(typed.replace('#', '')) || text.toLowerCase().includes(typed))
      .slice(0, 25)
      .map(({ row, text }) => ({ name: `#${row.number} · ${excerpt(text, 80) || 'reminder'}`.slice(0, 100), value: row.number })),
  );
}

function ringButtons(row) {
  if (row.every_ms) {
    return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ps:stop:${row.id}`).setStyle(ButtonStyle.Secondary).setLabel('Stop repeating'))];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ps:snooze:${row.id}:15`).setStyle(ButtonStyle.Secondary).setLabel('Snooze 15 min'),
      new ButtonBuilder().setCustomId(`ps:snooze:${row.id}:60`).setStyle(ButtonStyle.Secondary).setLabel('Snooze 1 hour'),
      new ButtonBuilder().setCustomId(`ps:done:${row.id}`).setStyle(ButtonStyle.Success).setLabel('Done'),
    ),
  ];
}

/** Rings one reminder: a ping in the reminders channel, a DM if asked for, and the original message updated. */
export async function ring(client, row, now = new Date()) {
  const original = await originalOf(client, row);
  if (!original) {
    store.finishReminder(row.id, 'cancelled');
    return 'gone';
  }
  const text = textOf(original);
  const late = now.getTime() - Date.parse(row.due_at) > 2 * 60_000;
  const content = `<@${row.user_id}> ⏰ ${excerpt(text, 1700)}${late ? `\n-# This was due ${timestamp(row.due_at, 'R')}, while the bot was offline.` : ''}`;
  await original.channel.send({ content, reply: { messageReference: original.id, failIfNotExists: false }, allowedMentions: { users: [row.user_id], repliedUser: false }, components: ringButtons(row) });

  if (row.dm) {
    const user = await client.users.fetch(row.user_id).catch(() => null);
    const guild = client.guilds.cache.get(row.guild_id);
    await user
      ?.send({ embeds: [new EmbedBuilder().setColor(COLORS.reminder).setTitle('⏰ Reminder').setDescription(text).addFields({ name: 'From your storage', value: original.url }).setFooter({ text: guild ? guild.name : 'Personal Storage' })] })
      .catch(() => {});
  }

  if (row.every_ms) store.reschedule(row.id, nextAfter(row.due_at, row.every_ms, now));
  else store.finishReminder(row.id, 'done');
  await original.edit({ embeds: [reminderEmbed(store.reminderById(row.id), text, now)] }).catch(() => {});
  return 'sent';
}

let sweeping = false;

export async function sweep(client, now = new Date()) {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const row of store.dueReminders(now.toISOString())) {
      try {
        await ring(client, row, now);
      } catch (error) {
        // A reminder that cannot be sent is spent, not retried every few seconds.
        console.error(`Reminder ${row.id} could not be sent:`, error);
        if (row.every_ms) store.reschedule(row.id, nextAfter(row.due_at, row.every_ms, now));
        else store.finishReminder(row.id, 'failed');
      }
    }
  } finally {
    sweeping = false;
  }
}

export function startClock(client) {
  client.once(Events.ClientReady, () => {
    sweep(client).catch((error) => console.error('Reminder sweep failed:', error));
    setInterval(() => sweep(client).catch((error) => console.error('Reminder sweep failed:', error)), TICK_MS).unref?.();
  });
}

async function ownRow(interaction, id) {
  const row = store.reminderById(Number(id));
  if (!row || row.user_id !== interaction.user.id) {
    await interaction.reply({ content: 'That reminder isn’t yours.', flags: EPHEMERAL });
    return null;
  }
  return row;
}

export async function snooze(interaction, id, minutes) {
  const row = await ownRow(interaction, id);
  if (!row) return;
  if (row.every_ms || row.status === 'cancelled') return interaction.update({ components: [] });
  const dueAt = new Date(Date.now() + Number(minutes) * 60_000);
  store.reschedule(row.id, dueAt);
  const original = await originalOf(interaction.client, row);
  if (original) await original.edit({ embeds: [reminderEmbed(store.reminderById(row.id), textOf(original))] }).catch(() => {});
  await interaction.update({ content: `${interaction.message.content}\n-# Snoozed until ${timestamp(dueAt, 't')}.`, components: [] });
}

export async function done(interaction, id) {
  if (!(await ownRow(interaction, id))) return;
  await interaction.update({ components: [] });
}

export async function stop(interaction, id) {
  const row = await ownRow(interaction, id);
  if (!row) return;
  store.finishReminder(row.id, 'cancelled');
  const original = await originalOf(interaction.client, row);
  if (original) await original.edit({ embeds: [reminderEmbed(store.reminderById(row.id), textOf(original))] }).catch(() => {});
  await interaction.update({ content: `${interaction.message.content}\n-# Stopped. It won’t ring again.`, components: [] });
}
