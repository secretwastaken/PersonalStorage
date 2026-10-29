import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_PATH = ':memory:';
const { KINDS, missingRequired, parseFields } = await import('../src/kinds.js');
const store = await import('../src/store.js');

// What Discord hands back for a message the bot sent: embeds as plain data.
const asMessage = (payload) => ({ content: payload.content ?? '', embeds: (payload.embeds ?? []).map((embed) => ({ data: embed.toJSON() })) });

test('every kind reads back what it wrote', () => {
  const samples = {
    note: { title: 'Generator', text: 'Fuel lasts about a week.\nKeep it outside.' },
    item: { name: 'Canned beans', quantity: 12, where: 'Base fridge', note: 'Eat the soup first' },
    place: { name: 'Muldraugh safehouse', x: 10583, y: 9654, floor: 1, note: 'Back door is broken' },
    journal: { title: 'Day 12', text: 'The first winter.' },
    screenshot: { caption: 'The horde at the gas station' },
  };
  for (const [id, data] of Object.entries(samples)) {
    const kind = KINDS[id];
    const read = kind.read(asMessage(kind.payload(data, 3)));
    assert.deepEqual(read, data, `${id} survives a round trip`);
    assert.ok(kind.label(read).length > 0);
  }
});

test('optional parts left empty stay out of the message', () => {
  const kind = KINDS.item;
  const payload = kind.payload({ name: 'Axe', quantity: 1, where: '', note: '' }, 1);
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.description, undefined);
  assert.deepEqual(embed.fields.map((field) => field.name), ['Quantity']);
  assert.deepEqual(kind.read(asMessage(payload)), { name: 'Axe', quantity: 1, where: '', note: '' });
});

test('fields are checked and defaulted', () => {
  assert.deepEqual(parseFields(KINDS.item, { name: ' Axe ' }).data, { name: 'Axe', quantity: 1, where: '', note: '' });
  assert.equal(parseFields(KINDS.place, { name: 'Base', x: '10', y: 'twelve' }).error, 'Y has to be a whole number.');
  assert.equal(parseFields(KINDS.place, { name: 'Base', x: 10, y: 20, floor: 99 }).error, 'Floor has to be between -32 and 32.');
  assert.equal(parseFields(KINDS.note, { text: '   ' }).error, 'Note is empty.');
  assert.equal(parseFields(KINDS.screenshot, { image: { name: 'notes.txt', contentType: 'text/plain' } }).error, 'That file is not a picture. PNG, JPG, GIF and WebP work.');
  assert.ok(parseFields(KINDS.screenshot, { image: { name: 'shot.png', contentType: 'image/png', url: 'https://x/shot.png' } }).data.image);
});

test('an edit only changes what was touched, and can clear an optional part', () => {
  const base = { name: 'Canned beans', quantity: 12, where: 'Base fridge', note: 'Old note' };
  const { data } = parseFields(KINDS.item, { name: 'Canned beans', quantity: '10', where: 'Base fridge', note: '' }, base);
  assert.deepEqual(data, { name: 'Canned beans', quantity: 10, where: 'Base fridge', note: '' });
});

test('a screenshot edit changes the caption and keeps the picture', () => {
  const { data } = parseFields(KINDS.screenshot, { caption: 'New caption' }, KINDS.screenshot.read({ content: '**📸 Screenshot #2**\nOld caption' }));
  assert.deepEqual(data, { caption: 'New caption' });
  assert.equal(KINDS.screenshot.payload(data, 2).files, undefined, 'the attachment is left alone');
});

test('a note without its text goes to a form', () => {
  assert.deepEqual(missingRequired(KINDS.note, { title: 'Just a title' }).map((field) => field.id), ['text']);
  assert.deepEqual(missingRequired(KINDS.note, { text: 'Written' }), []);
  assert.deepEqual(missingRequired(KINDS.screenshot, {}), [], 'a picture comes from the slash option or the form, never asked for twice');
});

test('numbers keep counting after a removal, per person and per kind', () => {
  assert.equal(store.nextNumber('g', 'a', 'note'), 1);
  const row = store.addEntry({ guildId: 'g', userId: 'a', kind: 'note', number: 1, channelId: 'c', messageId: 'm1' });
  store.removeEntry(row.id);
  assert.equal(store.nextNumber('g', 'a', 'note'), 2);
  assert.equal(store.nextNumber('g', 'a', 'item'), 1);
  assert.equal(store.nextNumber('g', 'b', 'note'), 1);
});

test('deleting a message or channel by hand forgets what was in it', () => {
  store.addEntry({ guildId: 'g', userId: 'c', kind: 'note', number: 1, channelId: 'notes', messageId: 'n1' });
  store.addEntry({ guildId: 'g', userId: 'c', kind: 'note', number: 2, channelId: 'notes', messageId: 'n2' });
  store.addReminder({ guildId: 'g', userId: 'c', number: 1, channelId: 'rem', messageId: 'r1', dueAt: new Date(Date.now() + 60_000) });
  store.forgetMessage('n1');
  assert.deepEqual(store.entries('g', 'c', 'note').map((row) => row.number), [2]);
  store.forgetMessage('r1');
  assert.equal(store.reminder('g', 'c', 1).status, 'cancelled');
  store.forgetChannel('notes');
  assert.deepEqual(store.entries('g', 'c', 'note'), []);
});
