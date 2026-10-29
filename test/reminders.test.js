import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_PATH = ':memory:';
const { applyAmount, parseWhen } = await import('../src/when.js');
const { parseRepeat, plan, reminderEmbed, textOf } = await import('../src/reminders.js');
const store = await import('../src/store.js');
const { COMMANDS } = await import('../src/commands.js');

const now = new Date('2026-10-29T15:00:00Z');

test('times read the way people type them', () => {
  assert.equal(parseWhen('2h', 'UTC', now).toISOString(), '2026-10-29T17:00:00.000Z');
  assert.equal(parseWhen('in 30 minutes', 'UTC', now).toISOString(), '2026-10-29T15:30:00.000Z');
  assert.equal(parseWhen('18:30', 'Europe/Lisbon', now).toISOString(), '2026-10-29T18:30:00.000Z');
  assert.equal(parseWhen('9:00', 'UTC', now).toISOString(), '2026-10-30T09:00:00.000Z', 'a time already gone today means tomorrow');
  assert.equal(parseWhen('tomorrow 9am', 'America/New_York', now).toISOString(), '2026-10-30T13:00:00.000Z');
  assert.equal(parseWhen('soon', 'UTC', now), null);
});

test('a reminder request is checked before anything is posted', () => {
  assert.ok(plan({ when: '2h' }, 'UTC', now).dueAt);
  assert.match(plan({ when: 'whenever' }, 'UTC', now).error, /couldn’t read/);
  assert.match(plan({ when: '2026-01-01 10:00' }, 'UTC', now).error, /passed/);
  assert.match(plan({ when: '2h', repeat: '5m' }, 'UTC', now).error, /10 minutes/);
  assert.equal(plan({ when: '2h', repeat: 'every 2 days' }, 'UTC', now).everyMs, 2 * 86_400_000);
  assert.equal(parseRepeat('daily'), 86_400_000);
  assert.equal(parseRepeat(''), null);
});

test('inventory amounts set, add and take', () => {
  assert.equal(applyAmount(5, '12'), 12);
  assert.equal(applyAmount(5, '+3'), 8);
  assert.equal(applyAmount(5, '- 2'), 3);
  assert.equal(applyAmount(5, '-9'), 0, 'never below nothing');
  assert.equal(applyAmount(5, 'lots'), null);
});

test('the reminder message carries its own text', () => {
  const embed = reminderEmbed({ number: 4, due_at: now.toISOString(), every_ms: 86_400_000, dm: 1, status: 'pending' }, 'Water the crops');
  const message = { embeds: [{ data: embed.toJSON() }] };
  assert.equal(textOf(message), 'Water the crops');
  assert.deepEqual(embed.toJSON().fields.map((field) => field.name), ['When', 'Repeats', 'Also by DM']);
});

test('due reminders come out once, and a repeat moves forward', () => {
  const past = new Date(Date.now() - 1000);
  const once = store.addReminder({ guildId: 'g', userId: 'u', number: 1, channelId: 'c', messageId: 'm1', dueAt: past });
  const daily = store.addReminder({ guildId: 'g', userId: 'u', number: 2, channelId: 'c', messageId: 'm2', dueAt: past, everyMs: 86_400_000 });
  assert.deepEqual(store.dueReminders().map((row) => row.id), [once.id, daily.id]);
  store.finishReminder(once.id, 'done');
  store.reschedule(daily.id, new Date(Date.now() + 86_400_000));
  assert.deepEqual(store.dueReminders(), []);
  assert.deepEqual(store.pendingReminders('g', 'u').map((row) => row.number), [2]);
});

test('every command fits Discord’s limits', () => {
  for (const command of COMMANDS) {
    const json = command.data.toJSON();
    assert.match(json.name, /^[a-z][a-z-]{0,31}$/);
    const walk = (options = []) => {
      for (const option of options) {
        assert.ok(option.description.length <= 100, `/${json.name} ${option.name}: description too long`);
        assert.match(option.name, /^[a-z][a-z0-9_-]{0,31}$/);
        walk(option.options);
      }
    };
    assert.ok(json.description.length <= 100);
    walk(json.options);
  }
});
