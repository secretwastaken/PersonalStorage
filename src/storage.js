import { ChannelType, OverwriteType, PermissionFlagsBits as P } from 'discord.js';
import * as store from './store.js';
import { CHANNELS, categoryName, homePanel } from './text.js';

// Discord stops at 500 channels in a server, and every storage takes a
// category plus its channels.
export const CHANNEL_LIMIT = 500;
export const CHANNELS_PER_STORAGE = CHANNELS.length + 1;

// What the owner of a storage may do inside it. Manage Messages lets them
// delete the bot's entries by hand, which the bot notices and follows.
export const MEMBER_ALLOW = [
  P.ViewChannel,
  P.SendMessages,
  P.ReadMessageHistory,
  P.AttachFiles,
  P.EmbedLinks,
  P.AddReactions,
  P.UseApplicationCommands,
  P.ManageMessages,
];

// The bot can only grant what it has itself, so this is also its invite list.
export const BOT_PERMISSIONS = [P.ViewChannel, P.ManageChannels, P.ManageRoles, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.AddReactions, P.UseApplicationCommands, P.ManageMessages];

export function overwrites(guild, userId) {
  return [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: userId, type: OverwriteType.Member, allow: MEMBER_ALLOW },
    { id: guild.members.me.id, type: OverwriteType.Member, allow: BOT_PERMISSIONS.filter((flag) => flag !== P.ManageRoles) },
  ];
}

export function missingPermissions(guild) {
  const me = guild.members.me;
  if (!me) return ['the bot is not in this server'];
  return BOT_PERMISSIONS.filter((flag) => !me.permissions.has(flag)).map((flag) => Object.keys(P).find((name) => P[name] === flag).replace(/([a-z])([A-Z])/g, '$1 $2'));
}

export const roomLeft = (guild) => Math.max(0, Math.floor((CHANNEL_LIMIT - guild.channels.cache.size) / CHANNELS_PER_STORAGE));

const channelIn = async (guild, id) => (id ? guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null)) : null);

/** The storage's category and channels as they are in Discord now; anything deleted is null. */
export async function look(guild, userId) {
  const row = store.storage(guild.id, userId);
  if (!row) return null;
  const ids = store.channels(guild.id, userId);
  const channels = {};
  for (const { kind } of CHANNELS) channels[kind] = await channelIn(guild, ids[kind]);
  return { row, category: await channelIn(guild, row.category_id), channels };
}

export const isEmpty = (found) => !found.category && Object.values(found.channels).every((channel) => !channel);

// A double click, or two clicks from a slow connection, must not build two
// categories, so creation is guarded per person while it runs.
const busy = new Set();

/**
 * Builds a storage. Returns { created: true, home } or { created: false, reason, home? }.
 * Anything half-built after a failure is taken down again, so a second try starts clean.
 */
export async function createStorage(guild, user) {
  const key = `${guild.id}:${user.id}`;
  if (busy.has(key)) return { created: false, reason: 'busy' };
  busy.add(key);
  try {
    const existing = await look(guild, user.id);
    if (existing && !isEmpty(existing)) return { created: false, reason: 'exists', home: existing.channels.home ?? null };
    if (existing) store.dropStorage(guild.id, user.id);

    const missing = missingPermissions(guild);
    if (missing.length) return { created: false, reason: 'permissions', missing };
    if (roomLeft(guild) < 1) return { created: false, reason: 'full' };

    const made = [];
    try {
      const reason = `Personal storage for ${user.username}`;
      const category = await guild.channels.create({ name: categoryName(user), type: ChannelType.GuildCategory, permissionOverwrites: overwrites(guild, user.id), reason });
      made.push(category);
      store.addStorage(guild.id, user.id, category.id);
      const ids = {};
      for (const spec of CHANNELS) {
        const channel = await guild.channels.create({ name: spec.name, type: ChannelType.GuildText, parent: category.id, topic: spec.topic, permissionOverwrites: overwrites(guild, user.id), reason });
        made.push(channel);
        ids[spec.kind] = channel.id;
        store.setChannel(guild.id, user.id, spec.kind, channel.id);
      }
      const home = made.find((channel) => channel.id === ids.home);
      const panel = await home.send(homePanel(user, ids));
      store.setHome(guild.id, user.id, panel.id);
      return { created: true, home };
    } catch (error) {
      for (const channel of made.reverse()) await channel.delete('Personal storage could not be finished').catch(() => {});
      store.dropStorage(guild.id, user.id);
      throw error;
    }
  } finally {
    busy.delete(key);
  }
}

/**
 * Puts a storage back the way it should be: missing category or channels are
 * made again, the privacy overwrites are re-applied, the category takes the
 * person's current name, and the home panel is posted again if it is gone.
 * Returns the list of what it fixed.
 */
export async function repairStorage(guild, user) {
  const found = await look(guild, user.id);
  if (!found) return null;
  const fixed = [];
  const reason = `Personal storage repair for ${user.username}`;
  const wanted = overwrites(guild, user.id);

  let category = found.category;
  if (!category) {
    category = await guild.channels.create({ name: categoryName(user), type: ChannelType.GuildCategory, permissionOverwrites: wanted, reason });
    store.setCategory(guild.id, user.id, category.id);
    fixed.push('made the category again');
  } else {
    if (category.name !== categoryName(user)) {
      await category.setName(categoryName(user), reason);
      fixed.push('renamed the category to your current name');
    }
    await category.permissionOverwrites.set(wanted, reason);
  }

  const ids = {};
  for (const spec of CHANNELS) {
    let channel = found.channels[spec.kind];
    if (!channel) {
      channel = await guild.channels.create({ name: spec.name, type: ChannelType.GuildText, parent: category.id, topic: spec.topic, permissionOverwrites: wanted, reason });
      store.setChannel(guild.id, user.id, spec.kind, channel.id);
      fixed.push(`made #${spec.kind} again`);
    } else {
      if (channel.parentId !== category.id) {
        await channel.setParent(category.id, { lockPermissions: false, reason });
        fixed.push(`moved #${spec.kind} back into the category`);
      }
      await channel.permissionOverwrites.set(wanted, reason);
    }
    ids[spec.kind] = channel.id;
  }

  const home = await channelIn(guild, ids.home);
  const panel = found.row.home_message_id ? await home.messages.fetch(found.row.home_message_id).catch(() => null) : null;
  if (panel) {
    await panel.edit(homePanel(user, ids));
  } else {
    const posted = await home.send(homePanel(user, ids));
    store.setHome(guild.id, user.id, posted.id);
    fixed.push('posted the home panel again');
  }
  return { fixed, home };
}

/** Deletes the category, its channels and every record of them. */
export async function deleteStorage(guild, userId) {
  const found = await look(guild, userId);
  if (!found) return false;
  const reason = 'Personal storage deleted by its owner';
  for (const channel of Object.values(found.channels)) if (channel) await channel.delete(reason).catch(() => {});
  if (found.category) {
    // Anything the person added to the category themselves goes with it.
    for (const child of guild.channels.cache.filter((channel) => channel.parentId === found.category.id).values()) await child.delete(reason).catch(() => {});
    await found.category.delete(reason).catch(() => {});
  }
  store.dropStorage(guild.id, userId);
  return true;
}
