import { Collection } from 'discord.js';

// Just enough of a Discord server for storages to be built, repaired and
// deleted in, with `present` standing in for who is a member.

let nextId = 1000;

export function fakeGuild({ filler = 0, permissions = true, failOn = null, present = null } = {}) {
  const cache = new Collection();
  let creates = 0;
  const guild = {
    id: `g${nextId++}`,
    roles: { everyone: { id: 'everyone' } },
    members: {
      me: { id: 'bot', permissions: { has: () => permissions } },
      fetch: async ({ user }) => {
        if (present && !present.has(user)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
        return { id: user, user: { id: user, username: user, displayName: user } };
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
