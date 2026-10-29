import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGuild, fakeMember } from './fakes.js';

process.env.DB_PATH = ':memory:';
const store = await import('../src/store.js');
const { createStorage } = await import('../src/storage.js');
const { check } = await import('../src/departures.js');
const { NO_STORAGE_ROLE, markEveryone, markMember, noStorageRole } = await import('../src/roles.js');

const wears = (member, role) => member.roles.cache.has(role.id);

test('the role is made once, however many ask at the same moment', async () => {
  const guild = fakeGuild();
  const [a, b] = await Promise.all([noStorageRole(guild), noStorageRole(guild)]);
  assert.equal(a.id, b.id);
  assert.equal(guild.roles.cache.size, 1);
  assert.equal(a.name, NO_STORAGE_ROLE);
  assert.equal(store.noStorageRole(guild.id), a.id);
});

test('a role the server already has by that name is used, not copied', async () => {
  const guild = fakeGuild();
  guild.roles.cache.set('existing', { id: 'existing', name: 'no personal storage', editable: true });
  assert.equal((await noStorageRole(guild)).id, 'existing');
  assert.equal(guild.roles.cache.size, 1);
});

test('an arrival without a storage gets the role, and making one takes it away', async () => {
  const guild = fakeGuild();
  const member = fakeMember(guild, 'u1');
  await markMember(member);
  const role = await noStorageRole(guild);
  assert.ok(wears(member, role));

  await createStorage(guild, member.user);
  await markMember(member);
  assert.ok(!wears(member, role));
});

test('an owner rejoining does not get the role', async () => {
  const guild = fakeGuild();
  const member = fakeMember(guild, 'u1');
  await createStorage(guild, member.user);
  await markMember(member);
  assert.ok(!wears(member, await noStorageRole(guild)));
});

test('at startup everyone is brought in line, bots aside', async () => {
  const guild = fakeGuild();
  const without = fakeMember(guild, 'u1');
  const owner = fakeMember(guild, 'u2');
  const bot = fakeMember(guild, 'b1', true);
  await createStorage(guild, owner.user);
  const role = await noStorageRole(guild);
  owner.roles.cache.set(role.id, role);

  await markEveryone(guild);
  assert.ok(wears(without, role));
  assert.ok(!wears(owner, role));
  assert.ok(!wears(bot, role));
});

test('the half-hourly check takes the role off an owner who still wears it', async () => {
  const guild = fakeGuild({ present: new Set(['u1']) });
  const owner = fakeMember(guild, 'u1');
  await createStorage(guild, owner.user);
  const role = await noStorageRole(guild);
  owner.roles.cache.set(role.id, role);
  await check(guild);
  assert.ok(!wears(owner, role));
});

test('a role above the bot is left alone', async () => {
  const guild = fakeGuild();
  guild.roles.cache.set('high', { id: 'high', name: NO_STORAGE_ROLE, editable: false });
  const member = fakeMember(guild, 'u1');
  const error = console.error;
  console.error = () => {};
  try {
    await markMember(member);
  } finally {
    console.error = error;
  }
  assert.equal(member.roles.cache.size, 0);
});

test('a role knocked off by another bot is put back on the second look', async () => {
  const { markUser } = await import('../src/roles.js');
  const guild = fakeGuild();
  const member = fakeMember(guild, 'u1');
  await markMember(member);
  const role = await noStorageRole(guild);
  member.roles.cache.delete(role.id);
  await markUser(guild, 'u1');
  assert.ok(wears(member, role));
});
