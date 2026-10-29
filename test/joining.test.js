import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGuild, fakeMember } from './fakes.js';

process.env.DB_PATH = ':memory:';
process.env.JOIN_ROLES = 'Member, 5000, Missing, Staff';
const { giveJoinRoles, joinRoles } = await import('../src/roles.js');

function guildWithRoles() {
  const guild = fakeGuild();
  for (const role of [
    { id: 'r-member', name: 'member', editable: true },
    { id: '5000', name: 'Survivor', editable: true },
    { id: 'r-staff', name: 'Staff', editable: false },
  ]) guild.roles.cache.set(role.id, role);
  return guild;
}

const quietly = async (fn) => {
  const error = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    await fn();
  } finally {
    console.error = error;
  }
  return logged.join('\n');
};

test('the join roles are found by name or id, and the ones out of reach are named', async () => {
  const guild = guildWithRoles();
  let found;
  const logged = await quietly(() => (found = joinRoles(guild)));
  assert.deepEqual(found.map((role) => role.id), ['r-member', '5000']);
  assert.match(logged, /"Missing", which is not a role/);
  assert.match(logged, /Staff role .* sits above the bot/);
});

test('an arrival gets every join role the bot can give, a bot gets none', async () => {
  const guild = guildWithRoles();
  const member = fakeMember(guild, 'u1');
  const bot = fakeMember(guild, 'b1', true);
  await quietly(async () => {
    await giveJoinRoles(member);
    await giveJoinRoles(bot);
  });
  assert.deepEqual([...member.roles.cache.keys()], ['r-member', '5000']);
  assert.equal(bot.roles.cache.size, 0);
});
