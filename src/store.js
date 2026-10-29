import { db, now, transaction } from './db.js';

// The database only knows which channels belong to whom, the numbers given
// to entries, and when reminders are due. What people write stays in their
// channels: an entry here is a pointer to a message, nothing more.
db.exec(`
  CREATE TABLE IF NOT EXISTS storages (
    guild_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    category_id     TEXT,
    home_message_id TEXT,
    created_at      TEXT NOT NULL,
    left_at         TEXT,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS storage_channels (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, kind)
  );
  CREATE INDEX IF NOT EXISTS storage_channels_by_id ON storage_channels (channel_id);

  CREATE TABLE IF NOT EXISTS counters (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    kind     TEXT NOT NULL,
    last     INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, kind)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    number     INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    UNIQUE (guild_id, user_id, kind, number)
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    number     INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    due_at     TEXT NOT NULL,
    every_ms   INTEGER,
    dm         INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    UNIQUE (guild_id, user_id, number)
  );
  CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, due_at);
  CREATE INDEX IF NOT EXISTS reminders_by_message ON reminders (message_id);

  CREATE TABLE IF NOT EXISTS people (
    user_id  TEXT PRIMARY KEY,
    timezone TEXT
  );

  CREATE TABLE IF NOT EXISTS roles (
    guild_id           TEXT PRIMARY KEY,
    no_storage_role_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS panels (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL
  );
`);

// Databases from before 1.2.0 were made without left_at.
if (!db.prepare('PRAGMA table_info(storages)').all().some((column) => column.name === 'left_at')) db.exec('ALTER TABLE storages ADD COLUMN left_at TEXT');

const s = {
  storage: db.prepare('SELECT * FROM storages WHERE guild_id = ? AND user_id = ?'),
  storages: db.prepare('SELECT * FROM storages WHERE guild_id = ? ORDER BY created_at'),
  insertStorage: db.prepare('INSERT INTO storages (guild_id, user_id, category_id, created_at) VALUES (?, ?, ?, ?)'),
  setCategory: db.prepare('UPDATE storages SET category_id = ? WHERE guild_id = ? AND user_id = ?'),
  setHome: db.prepare('UPDATE storages SET home_message_id = ? WHERE guild_id = ? AND user_id = ?'),
  setLeft: db.prepare('UPDATE storages SET left_at = ? WHERE guild_id = ? AND user_id = ?'),
  channels: db.prepare('SELECT kind, channel_id FROM storage_channels WHERE guild_id = ? AND user_id = ?'),
  setChannel: db.prepare('INSERT INTO storage_channels (guild_id, user_id, kind, channel_id) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id, kind) DO UPDATE SET channel_id = excluded.channel_id'),
  ownerOfChannel: db.prepare('SELECT guild_id, user_id, kind FROM storage_channels WHERE channel_id = ?'),
  ownerOfCategory: db.prepare('SELECT guild_id, user_id FROM storages WHERE category_id = ?'),
  bump: db.prepare('INSERT INTO counters (guild_id, user_id, kind, last) VALUES (?, ?, ?, 1) ON CONFLICT (guild_id, user_id, kind) DO UPDATE SET last = last + 1 RETURNING last'),
  insertEntry: db.prepare('INSERT INTO entries (guild_id, user_id, kind, number, channel_id, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  entry: db.prepare('SELECT * FROM entries WHERE guild_id = ? AND user_id = ? AND kind = ? AND number = ?'),
  entries: db.prepare('SELECT * FROM entries WHERE guild_id = ? AND user_id = ? AND kind = ? ORDER BY number DESC'),
  entryCounts: db.prepare('SELECT kind, COUNT(*) AS n FROM entries WHERE guild_id = ? AND user_id = ? GROUP BY kind'),
  removeEntry: db.prepare('DELETE FROM entries WHERE id = ?'),
  removeEntryByMessage: db.prepare('DELETE FROM entries WHERE message_id = ?'),
  removeEntriesInChannel: db.prepare('DELETE FROM entries WHERE channel_id = ?'),
  insertReminder: db.prepare('INSERT INTO reminders (guild_id, user_id, number, channel_id, message_id, due_at, every_ms, dm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  reminderById: db.prepare('SELECT * FROM reminders WHERE id = ?'),
  reminder: db.prepare('SELECT * FROM reminders WHERE guild_id = ? AND user_id = ? AND number = ?'),
  pending: db.prepare("SELECT * FROM reminders WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY due_at"),
  due: db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at"),
  setReminder: db.prepare('UPDATE reminders SET due_at = ?, status = ? WHERE id = ?'),
  cancelByMessage: db.prepare("UPDATE reminders SET status = 'cancelled' WHERE message_id = ? AND status = 'pending'"),
  cancelInChannel: db.prepare("UPDATE reminders SET status = 'cancelled' WHERE channel_id = ? AND status = 'pending'"),
  timezone: db.prepare('SELECT timezone FROM people WHERE user_id = ?'),
  setTimezone: db.prepare('INSERT INTO people (user_id, timezone) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET timezone = excluded.timezone'),
  panel: db.prepare('SELECT * FROM panels WHERE guild_id = ?'),
  setPanel: db.prepare('INSERT INTO panels (guild_id, channel_id, message_id) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id'),
  noStorageRole: db.prepare('SELECT no_storage_role_id FROM roles WHERE guild_id = ?'),
  setNoStorageRole: db.prepare('INSERT INTO roles (guild_id, no_storage_role_id) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET no_storage_role_id = excluded.no_storage_role_id'),
  dropStorage: [
    db.prepare('DELETE FROM storages WHERE guild_id = ? AND user_id = ?'),
    db.prepare('DELETE FROM storage_channels WHERE guild_id = ? AND user_id = ?'),
    db.prepare('DELETE FROM counters WHERE guild_id = ? AND user_id = ?'),
    db.prepare('DELETE FROM entries WHERE guild_id = ? AND user_id = ?'),
    db.prepare('DELETE FROM reminders WHERE guild_id = ? AND user_id = ?'),
  ],
};

export const storage = (guildId, userId) => s.storage.get(guildId, userId) ?? null;
export const storages = (guildId) => s.storages.all(guildId);
export const addStorage = (guildId, userId, categoryId) => s.insertStorage.run(guildId, userId, categoryId, now());
export const setCategory = (guildId, userId, categoryId) => s.setCategory.run(categoryId, guildId, userId);
export const setHome = (guildId, userId, messageId) => s.setHome.run(messageId, guildId, userId);
export const setLeft = (guildId, userId, at) => s.setLeft.run(at ? new Date(at).toISOString() : null, guildId, userId);

export function channels(guildId, userId) {
  return Object.fromEntries(s.channels.all(guildId, userId).map((row) => [row.kind, row.channel_id]));
}
export const setChannel = (guildId, userId, kind, channelId) => s.setChannel.run(guildId, userId, kind, channelId);
export const ownerOfChannel = (channelId) => s.ownerOfChannel.get(channelId) ?? null;
export const ownerOfCategory = (categoryId) => s.ownerOfCategory.get(categoryId) ?? null;

export function dropStorage(guildId, userId) {
  transaction(() => {
    for (const statement of s.dropStorage) statement.run(guildId, userId);
  });
}

// Numbers are never reused: after removing note #3 the next one is still #4,
// so a number someone wrote down elsewhere never points at the wrong thing.
export const nextNumber = (guildId, userId, kind) => Number(s.bump.get(guildId, userId, kind).last);

export function addEntry({ guildId, userId, kind, number, channelId, messageId }) {
  s.insertEntry.run(guildId, userId, kind, number, channelId, messageId, now());
  return s.entry.get(guildId, userId, kind, number);
}
export const entry = (guildId, userId, kind, number) => s.entry.get(guildId, userId, kind, number) ?? null;
export const entries = (guildId, userId, kind) => s.entries.all(guildId, userId, kind);
export function entryCounts(guildId, userId) {
  return Object.fromEntries(s.entryCounts.all(guildId, userId).map((row) => [row.kind, Number(row.n)]));
}
export const removeEntry = (id) => s.removeEntry.run(id);

export function addReminder({ guildId, userId, number, channelId, messageId, dueAt, everyMs = null, dm = false }) {
  const { lastInsertRowid } = s.insertReminder.run(guildId, userId, number, channelId, messageId, new Date(dueAt).toISOString(), everyMs, dm ? 1 : 0, now());
  return s.reminderById.get(lastInsertRowid);
}
export const reminderById = (id) => s.reminderById.get(id) ?? null;
export const reminder = (guildId, userId, number) => s.reminder.get(guildId, userId, number) ?? null;
export const pendingReminders = (guildId, userId) => s.pending.all(guildId, userId);
export const dueReminders = (at = now()) => s.due.all(at);
export const reschedule = (id, dueAt) => s.setReminder.run(new Date(dueAt).toISOString(), 'pending', id);
export function finishReminder(id, status) {
  const row = reminderById(id);
  if (row) s.setReminder.run(row.due_at, status, id);
}

// A message or channel deleted by hand takes its entries and reminders with it.
export function forgetMessage(messageId) {
  s.removeEntryByMessage.run(messageId);
  s.cancelByMessage.run(messageId);
}
export function forgetChannel(channelId) {
  s.removeEntriesInChannel.run(channelId);
  s.cancelInChannel.run(channelId);
}

export const timezone = (userId) => s.timezone.get(userId)?.timezone ?? null;
export const setTimezone = (userId, zone) => s.setTimezone.run(userId, zone);

export const panel = (guildId) => s.panel.get(guildId) ?? null;
export const setPanel = (guildId, channelId, messageId) => s.setPanel.run(guildId, channelId, messageId);

export const noStorageRole = (guildId) => s.noStorageRole.get(guildId)?.no_storage_role_id ?? null;
export const setNoStorageRole = (guildId, roleId) => s.setNoStorageRole.run(guildId, roleId);
