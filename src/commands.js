import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as entries from './entries.js';
import { KINDS } from './kinds.js';
import * as reminders from './reminders.js';
import { markMember, noStorageRole } from './roles.js';
import * as store from './store.js';
import { CHANNELS_PER_STORAGE, createStorage, deleteStorage, isEmpty, look, missingPermissions, repairStorage, roomLeft } from './storage.js';
import { COLORS, setupPanel } from './text.js';
import { EPHEMERAL, noStorageText, say } from './ui.js';
import { config } from './config.js';
import { validTimezone, wallClock, zoneLabel } from './when.js';

export const timezoneSet = (zone) => `🕒 Your reminders now use ${zoneLabel(zone)} time (${zone}), where it is ${wallClock(new Date(), zone)}.`;

const guildOnly = (builder) => builder.setContexts(InteractionContextType.Guild);

function addFieldOptions(sub, kind) {
  // Discord wants required options before optional ones.
  const fields = [...kind.fields].sort((a, b) => Number(Boolean(b.slashRequired)) - Number(Boolean(a.slashRequired)));
  for (const field of fields) {
    const required = Boolean(field.slashRequired);
    if (field.type === 'file') sub.addAttachmentOption((o) => o.setName(field.id).setDescription(field.description).setRequired(required));
    else if (field.type === 'integer') sub.addIntegerOption((o) => o.setName(field.id).setDescription(field.description).setRequired(required).setMinValue(field.min).setMaxValue(field.max));
    else sub.addStringOption((o) => o.setName(field.id).setDescription(field.description).setRequired(required).setMaxLength(Math.min(field.max, 6000)));
  }
  return sub;
}

function entryCommand(kind) {
  const pick = (o) => o.setName(kind.noun).setDescription(`Which ${kind.noun} (start typing to search)`).setRequired(true).setAutocomplete(true).setMinValue(1);
  const builder = guildOnly(new SlashCommandBuilder().setName(kind.id).setDescription(kind.description))
    .addSubcommand((sub) => addFieldOptions(sub.setName('add').setDescription(`Save a ${kind.noun}`), kind))
    .addSubcommand((sub) => sub.setName('edit').setDescription(`Change a ${kind.noun}`).addIntegerOption(pick))
    .addSubcommand((sub) => sub.setName('remove').setDescription(`Delete a ${kind.noun}`).addIntegerOption(pick))
    .addSubcommand((sub) => sub.setName('list').setDescription(`Show your ${kind.id === 'journal' ? 'journal entries' : `${kind.noun}s`}`));
  if (kind.id === 'item') {
    builder.addSubcommand((sub) =>
      sub
        .setName('amount')
        .setDescription('Change how many you have')
        .addIntegerOption(pick)
        .addStringOption((o) => o.setName('change').setDescription('12 sets it, +3 adds, -2 takes away').setRequired(true).setMaxLength(9)),
    );
  }
  return {
    data: builder,
    execute: (interaction) => {
      const sub = interaction.options.getSubcommand();
      if (sub === 'amount') return entries.amount(interaction);
      return entries[sub](interaction, kind);
    },
    autocomplete: (interaction) => entries.autocomplete(interaction, kind),
  };
}

const remind = {
  data: guildOnly(new SlashCommandBuilder().setName('remind').setDescription('Reminders in your reminders channel'))
    .addSubcommand((sub) =>
      sub
        .setName('me')
        .setDescription('Set a reminder')
        .addStringOption((o) => o.setName('when').setDescription('2h, 30m, 18:30, tomorrow 9:00, 24/12 20:00').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('what').setDescription('What to remind you of').setRequired(true).setMaxLength(reminders.MAX_TEXT))
        .addStringOption((o) => o.setName('repeat').setDescription('Repeat every… (1d, 12h, 1w). Leave out for once.').setMaxLength(20))
        .addBooleanOption((o) => o.setName('dm').setDescription('Also send it to you by DM'))
        .addStringOption((o) => {
          o.setName('zone').setDescription('Which clock a time like 18:30 is on (yours if left out)');
          // Discord shows at most 25 fixed choices; beyond that the zone is typed.
          if (config.timezones.length <= 25) o.addChoices(...config.timezones.map((zone) => ({ name: `${zoneLabel(zone)} time`, value: zone })));
          return o.setMaxLength(64);
        }),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the reminders waiting'))
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel a reminder')
        .addIntegerOption((o) => o.setName('reminder').setDescription('Which reminder (start typing to search)').setRequired(true).setAutocomplete(true).setMinValue(1)),
    ),
  execute: (interaction) => {
    const sub = interaction.options.getSubcommand();
    if (sub === 'me') return reminders.remindMe(interaction);
    if (sub === 'list') return reminders.list(interaction);
    return reminders.cancel(interaction);
  },
  autocomplete: (interaction) => reminders.autocomplete(interaction),
};

export async function create(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const result = await createStorage(interaction.guild, interaction.user);
  if (result.created || result.reason === 'exists') await markMember(interaction.member);
  if (result.created) return say(interaction, `🗄️ Your storage is ready: ${result.home}. Only you can see it.`);
  if (result.reason === 'exists') {
    return say(interaction, result.home ? `You already have a storage: ${result.home}.` : 'You already have a storage, but its home channel is gone. `/storage repair` puts it back.');
  }
  if (result.reason === 'busy') return say(interaction, 'Your storage is being built right now. It’ll show up in a moment.');
  if (result.reason === 'permissions') return say(interaction, `I can’t build storages yet: the bot is missing ${result.missing.join(', ')}. Ask an admin to give the bot’s role those permissions.`);
  return say(interaction, `There’s no room for another storage: Discord allows 500 channels in a server and each storage takes ${CHANNELS_PER_STORAGE}. Ask an admin.`);
}

export async function info(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const found = await look(interaction.guild, interaction.user.id);
  if (!found || isEmpty(found)) return say(interaction, noStorageText(interaction.guildId));
  const counts = store.entryCounts(interaction.guildId, interaction.user.id);
  const pending = store.pendingReminders(interaction.guildId, interaction.user.id);
  const link = (kind) => (found.channels[kind] ? `${found.channels[kind]}` : `#${kind} (gone, \`/storage repair\`)`);
  const lines = [
    `⏰ ${link('reminders')}: ${pending.length} waiting${pending[0] ? `, next <t:${Math.floor(Date.parse(pending[0].due_at) / 1000)}:R>` : ''}`,
    ...Object.values(KINDS).map((kind) => `${kind.emoji} ${link(kind.channel)}: ${counts[kind.id] ?? 0} saved by the bot`),
  ];
  const embed = new EmbedBuilder()
    .setColor(COLORS.panel)
    .setTitle('🗄️ Your storage')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Time zone', value: `${reminders.zoneOf(interaction.user.id)}${store.timezone(interaction.user.id) ? '' : ' (the server’s default; `/storage timezone` sets yours)'}` })
    .setFooter({ text: 'Counts are the entries the bot posted. Anything you typed yourself is yours to keep track of.' });
  await say(interaction, { embeds: [embed] });
}

const storageCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('storage').setDescription('Your personal storage'))
    .addSubcommand((sub) => sub.setName('create').setDescription('Create your personal storage'))
    .addSubcommand((sub) => sub.setName('info').setDescription('See what is in your storage'))
    .addSubcommand((sub) =>
      sub
        .setName('timezone')
        .setDescription('Set the time zone your reminders use')
        .addStringOption((o) => o.setName('zone').setDescription('Like Europe/Lisbon or America/New_York (start typing to search)').setRequired(true).setAutocomplete(true).setMaxLength(64)),
    )
    .addSubcommand((sub) => sub.setName('repair').setDescription('Bring back deleted channels and fix the privacy settings'))
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete your storage and everything in it')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction);
    if (sub === 'info') return info(interaction);
    if (sub === 'timezone') {
      const zone = interaction.options.getString('zone', true).trim();
      if (!validTimezone(zone)) return say(interaction, `“${zone}” isn’t a time zone I know. Pick one from the list as you type, like Europe/Lisbon.`);
      store.setTimezone(interaction.user.id, zone);
      return say(interaction, timezoneSet(zone));
    }
    if (sub === 'repair') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const missing = missingPermissions(interaction.guild);
      if (missing.length) return say(interaction, `I can’t repair anything: the bot is missing ${missing.join(', ')}.`);
      const result = await repairStorage(interaction.guild, interaction.user);
      if (!result) return say(interaction, noStorageText(interaction.guildId));
      return say(interaction, result.fixed.length ? `🔧 Done. I ${result.fixed.join(', ')}. ${result.home}` : `🔧 Everything was in place already. The privacy settings were checked again. ${result.home}`);
    }
    const found = store.storage(interaction.guildId, interaction.user.id);
    if (!found) return say(interaction, 'You don’t have a storage to delete.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ps:delete:yes').setStyle(ButtonStyle.Danger).setLabel('Delete everything'),
      new ButtonBuilder().setCustomId('ps:delete:no').setStyle(ButtonStyle.Secondary).setLabel('Keep it'),
    );
    return interaction.reply({ content: '⚠️ This deletes your whole storage: every channel, note, item, place, screenshot, journal entry and reminder in it. It can’t be undone.', components: [row], flags: EPHEMERAL });
  },
  async autocomplete(interaction) {
    const typed = String(interaction.options.getFocused() ?? '').toLowerCase().replace(/\s+/g, '_');
    // The server's own zones come first, so most people pick from two lines.
    const zones = [...new Set([...config.timezones, ...Intl.supportedValuesOf('timeZone')])];
    await interaction.respond(zones.filter((zone) => zone.toLowerCase().includes(typed)).slice(0, 25).map((zone) => ({ name: config.timezones.includes(zone) ? `${zone} (${zoneLabel(zone)}, used on this server)` : zone, value: zone })));
  },
};

export async function confirmDelete(interaction, answer) {
  if (answer !== 'yes') return interaction.update({ content: 'Kept. Nothing was deleted.', components: [] });
  await interaction.update({ content: 'Deleting your storage…', components: [] });
  await deleteStorage(interaction.guild, interaction.user.id);
  await markMember(interaction.member);
  // The reply may have lived in a channel that no longer exists.
  await interaction.editReply({ content: '🗑️ Your storage is gone, with everything in it. You can make a new one any time.' }).catch(() => {});
}

const setup = {
  data: guildOnly(new SlashCommandBuilder().setName('setup').setDescription('Post the "create your personal storage" panel in this channel')).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const guild = interaction.guild;
    const here = interaction.channel;
    const me = guild.members.me;
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (!here || !here.permissionsFor(me)?.has(needed)) return say(interaction, 'I can’t post here: the bot needs to see this channel, send messages and embed links in it.');

    const previous = store.panel(guild.id);
    if (previous) {
      const old = await guild.channels.cache.get(previous.channel_id)?.messages.fetch(previous.message_id).catch(() => null);
      await old?.delete().catch(() => {});
    }
    const posted = await here.send(setupPanel());
    store.setPanel(guild.id, here.id, posted.id);

    const lines = [`✅ The panel is up in ${here}${previous ? ', and the old one is gone' : ''}.`, `${store.storages(guild.id).length} storages so far, room for about ${roomLeft(guild)} more.`];
    const missing = missingPermissions(guild);
    if (missing.length) lines.push(`⚠️ The bot is missing ${missing.join(', ')}. Storages can’t be built until its role has them.`);
    // The privacy note tells members nobody else can look inside. These are
    // the ways that could stop being true, so whoever sets it up hears them.
    const admins = guild.roles.cache.filter((role) => !role.managed && role.permissions.has(PermissionFlagsBits.Administrator));
    if (admins.size) lines.push(`⚠️ ${[...admins.values()].join(', ')} ${admins.size === 1 ? 'has' : 'have'} Administrator, which sees every channel whatever its settings. The panel promises nobody else can look into a storage, so take Administrator off ${admins.size === 1 ? 'it' : 'them'}. Manage Server is enough to run /setup.`);
    const role = await noStorageRole(guild);
    lines.push(role ? `Members without a storage wear ${role}, and lose it when they make one.` : '⚠️ I couldn’t make or hand out the No Personal Storage role: the bot’s own role needs to sit above it. The log says which.');
    if (interaction.user.id === guild.ownerId) lines.push('⚠️ You own this server, and the owner can see every channel. The panel says the owner is an account nobody uses.');
    await say(interaction, lines.join('\n\n'));
  },
};

export const COMMANDS = [setup, storageCommand, remind, ...Object.values(KINDS).map(entryCommand)];
export const byName = new Map(COMMANDS.map((command) => [command.data.name, command]));
