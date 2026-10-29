import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGuild } from './fakes.js';

process.env.DB_PATH = ':memory:';
const store = await import('../src/store.js');
const { createStorage } = await import('../src/storage.js');
const { GRACE_MS, check } = await import('../src/departures.js');

const user = { id: 'u1', username: 'survivor', displayName: 'Survivor' };
const DAY = 86_400_000;

async function storageOf(present) {
  const guild = fakeGuild({ present });
  await createStorage(guild, user);
  return guild;
}

test('a member who stays keeps their storage, and nothing is marked', async () => {
  const guild = await storageOf(new Set([user.id]));
  await check(guild);
  assert.equal(store.storage(guild.id, user.id).left_at, null);
  assert.equal(guild.channels.cache.size, 8);
});

test('a storage waits a week for an owner who left, then goes', async () => {
  const present = new Set();
  const guild = await storageOf(present);
  const left = Date.now();
  await check(guild, left);
  assert.equal(store.storage(guild.id, user.id).left_at, new Date(left).toISOString());

  await check(guild, left + 6 * DAY);
  assert.equal(guild.channels.cache.size, 8, 'still there after six days');

  await check(guild, left + GRACE_MS);
  assert.equal(guild.channels.cache.size, 0, 'the category and every channel are gone');
  assert.equal(store.storage(guild.id, user.id), null);
});

test('coming back within the week keeps everything, and the clock starts over next time', async () => {
  const present = new Set();
  const guild = await storageOf(present);
  const left = Date.now();
  await check(guild, left);

  present.add(user.id);
  await check(guild, left + 3 * DAY);
  assert.equal(store.storage(guild.id, user.id).left_at, null);
  assert.equal(guild.channels.cache.size, 8);

  present.delete(user.id);
  await check(guild, left + GRACE_MS);
  assert.equal(guild.channels.cache.size, 8, 'a second leave gets a week of its own');
});

test('when Discord cannot say, nothing is marked or deleted', async () => {
  const guild = await storageOf(new Set());
  guild.members.fetch = async () => {
    throw Object.assign(new Error('Service unavailable'), { code: 0 });
  };
  await check(guild);
  assert.equal(store.storage(guild.id, user.id).left_at, null);
});
