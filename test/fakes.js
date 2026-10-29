import { Collection } from 'discord.js';

// Just enough of a Discord server for storages to be built, repaired and
// deleted in, with `present` standing in for who is a member.

let nextId = 1000;

// Members are kept per guild, so the roles one is given are still on them
// the next time they are fetched.
export function fakeMember(guild, id, bot = false) {
  guild.people ??= new Map();
  if (!guild.people.has(id)) {
    const roles = new Collection();
    guild.people.set(id, {
      id,
      guild,
      user: { id, bot, username: id, displayName: id },
      roles: { cache: roles, add: async (role) => void roles.set(role.id, role), remove: async (role) => void roles.delete(role.id) },
    });
  }
  return guild.people.get(id);
}

export function fakeGuild({ filler = 0, permissions = true, failOn = null, present = null } = {}) {
  const cache = new Collection();
  let creates = 0;
  const guild = {
    id: `g${nextId++}`,
    roles: {
      everyone: { id: 'everyone' },
      cache: new Collection(),
      create: async ({ name }) => {
        const role = { id: `r${nextId++}`, name, editable: true, toString: () => `@${name}` };
        guild.roles.cache.set(role.id, role);
        return role;
      },
    },
    members: {
      me: { id: 'bot', permissions: { has: () => permissions } },
      fetch: async (asked) => {
        if (asked === undefined) return new Collection(guild.people ?? []);
        const user = typeof asked === 'string' ? asked : asked.user;
        if (present && !present.has(user)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
        return fakeMember(guild, user);
      },
    },
    channels: {
      cache,
      fetch: async (id) => cache.get(id) ?? null,
      create: async (options) => {
        creates += 1;
        if (failOn === creates) throw new Error('Discord said no');
        const channel = fakeChannel(options, cache);
        cache.set(channel.id, channel);
        return channel;
      },
    },
  };
  for (let i = 0; i < filler; i++) cache.set(`filler${i}`, { id: `filler${i}` });
  return guild;
}

function fakeChannel(options, cache) {
  const id = String(nextId++);
  const messages = new Collection();
  const channel = {
    id,
    name: options.name,
    type: options.type,
    parentId: options.parent ?? null,
    overwrites: options.permissionOverwrites,
    permissionOverwrites: { set: async (overwrites) => void (channel.overwrites = overwrites) },
    setName: async (name) => void (channel.name = name),
    setParent: async (parent) => void (channel.parentId = parent),
    delete: async () => void cache.delete(id),
    send: async (payload) => {
      const message = { id: String(nextId++), channelId: id, payload, edit: async (next) => void (message.payload = next) };
      messages.set(message.id, message);
      return message;
    },
    messages: {
      cache: messages,
      fetch: async (messageId) => {
        if (!messages.has(messageId)) throw new Error('Unknown Message');
        return messages.get(messageId);
      },
    },
    toString: () => `<#${id}>`,
  };
  return channel;
}
