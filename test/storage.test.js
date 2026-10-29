import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelType, Collection, PermissionFlagsBits as P } from 'discord.js';

process.env.DB_PATH = ':memory:';
const store = await import('../src/store.js');
const { createStorage, deleteStorage, repairStorage, CHANNELS_PER_STORAGE } = await import('../src/storage.js');
const { CHANNELS } = await import('../src/text.js');

let nextId = 1000;

function fakeGuild({ filler = 0, permissions = true, failOn = null } = {}) {
  const cache = new Collection();
  let creates = 0;
  const guild = {
    id: `g${nextId++}`,
    roles: { everyone: { id: 'everyone' } },
    members: { me: { id: 'bot', permissions: { has: () => permissions } } },
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

const user = { id: 'u1', username: 'survivor', displayName: 'Survivor' };

function assertPrivate(channel) {
  const everyone = channel.overwrites.find((o) => o.id === 'everyone');
  const owner = channel.overwrites.find((o) => o.id === user.id);
  const bot = channel.overwrites.find((o) => o.id === 'bot');
  assert.ok(everyone.deny.includes(P.ViewChannel), `${channel.name} hides itself from everyone`);
  assert.ok(owner.allow.includes(P.ViewChannel), `${channel.name} shows itself to its owner`);
  assert.ok(bot.allow.includes(P.ViewChannel), `${channel.name} lets the bot in`);
  assert.equal(channel.overwrites.length, 3, 'nobody else is named');
}

test('a storage is a private category with every channel in it', async () => {
  const guild = fakeGuild();
  const result = await createStorage(guild, user);
  assert.equal(result.created, true);
  const category = [...guild.channels.cache.values()].find((channel) => channel.type === ChannelType.GuildCategory);
  assert.equal(category.name, "Survivor's Personal Storage");
  assertPrivate(category);
  const children = [...guild.channels.cache.values()].filter((channel) => channel.parentId === category.id);
  assert.deepEqual(children.map((channel) => channel.name), CHANNELS.map((spec) => spec.name));
  children.forEach(assertPrivate);
  assert.equal(guild.channels.cache.size, CHANNELS_PER_STORAGE);
  const row = store.storage(guild.id, user.id);
  assert.equal(row.category_id, category.id);
  assert.ok(row.home_message_id, 'the home panel was posted');
  assert.equal(Object.keys(store.channels(guild.id, user.id)).length, CHANNELS.length);
});

test('a second click points at the storage that exists', async () => {
  const guild = fakeGuild();
  await createStorage(guild, user);
  const again = await createStorage(guild, user);
  assert.equal(again.created, false);
  assert.equal(again.reason, 'exists');
  assert.equal(guild.channels.cache.size, CHANNELS_PER_STORAGE);
});

test('two clicks at once build one storage', async () => {
  const guild = fakeGuild();
  const [first, second] = await Promise.all([createStorage(guild, user), createStorage(guild, user)]);
  assert.deepEqual([first.created, second.reason], [true, 'busy']);
  assert.equal(guild.channels.cache.size, CHANNELS_PER_STORAGE);
});

test('a full server and missing permissions are refused before anything is made', async () => {
  const full = fakeGuild({ filler: 500 - CHANNELS_PER_STORAGE + 1 });
  assert.equal((await createStorage(full, user)).reason, 'full');
  const weak = fakeGuild({ permissions: false });
  const refused = await createStorage(weak, user);
  assert.equal(refused.reason, 'permissions');
  assert.ok(refused.missing.includes('Manage Roles'));
  assert.equal(weak.channels.cache.size, 0);
});

test('a storage that fails half-way is taken down again', async () => {
  const guild = fakeGuild({ failOn: 4 });
  await assert.rejects(createStorage(guild, user), /Discord said no/);
  assert.equal(guild.channels.cache.size, 0);
  assert.equal(store.storage(guild.id, user.id), null);
});

test('a storage deleted by hand can be made again from scratch', async () => {
  const guild = fakeGuild();
  await createStorage(guild, user);
  guild.channels.cache.clear();
  const result = await createStorage(guild, user);
  assert.equal(result.created, true);
  assert.equal(guild.channels.cache.size, CHANNELS_PER_STORAGE);
});

test('repair brings back a deleted channel and the privacy settings', async () => {
  const guild = fakeGuild();
  await createStorage(guild, user);
  const ids = store.channels(guild.id, user.id);
  guild.channels.cache.delete(ids.notes);
  const home = guild.channels.cache.get(ids.home);
  home.overwrites = [];
  const renamed = { ...user, displayName: 'Survivor Two' };
  const result = await repairStorage(guild, renamed);
  assert.ok(result.fixed.includes('made #notes again'));
  assert.ok(result.fixed.some((line) => line.startsWith('renamed')));
  assertPrivate(home);
  const notes = guild.channels.cache.get(store.channels(guild.id, user.id).notes);
  assert.ok(notes);
  assertPrivate(notes);
});

test('delete takes the channels and every record with it', async () => {
  const guild = fakeGuild();
  await createStorage(guild, user);
  store.nextNumber(guild.id, user.id, 'note');
  assert.equal(await deleteStorage(guild, user.id), true);
  assert.equal(guild.channels.cache.size, 0);
  assert.equal(store.storage(guild.id, user.id), null);
  assert.deepEqual(store.channels(guild.id, user.id), {});
  assert.equal(store.nextNumber(guild.id, user.id, 'note'), 1, 'numbering starts over');
});
