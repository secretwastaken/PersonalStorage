import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The .env beside package.json wins over whatever the shell exported, so a
// stale variable from some other project can never sneak in. The one
// exception is a process that asked for an in-memory database: that is the
// tests, and they must never reach the real .env or the real database.
const inMemory = (process.env.DB_PATH ?? '').trim() === ':memory:';
try {
  if (!inMemory) Object.assign(process.env, parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8')));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const trimmed = (value) => (value ?? '').trim();

function validZone(zone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const dbPath = trimmed(process.env.DB_PATH);

/** "Europe/Lisbon, America/New_York" as a list, without blanks or repeats. */
export const parseList = (text) => [...new Set(String(text ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
export const parseZones = parseList;

// The server's time zones. Members pick one of them as their clock, and every
// reminder shows its time in each; the first is used until someone picks.
const timezones = parseZones(process.env.TIMEZONE);
if (!timezones.length) timezones.push('UTC');

export const config = {
  token: trimmed(process.env.DISCORD_TOKEN),
  clientId: trimmed(process.env.DISCORD_CLIENT_ID),
  devGuildId: trimmed(process.env.DISCORD_GUILD_ID) || null,
  timezones,
  timezone: timezones[0],
  // Roles every member gets on joining, by name or id.
  joinRoles: parseList(process.env.JOIN_ROLES),
  dbPath: dbPath === ':memory:' ? ':memory:' : resolve(ROOT, dbPath || 'data/personal-storage.db'),
};

export function configProblems() {
  const problems = [];
  if (!config.token) problems.push('DISCORD_TOKEN is empty. Copy the bot token from the Developer Portal into .env.');
  if (!/^\d{17,20}$/.test(config.clientId)) problems.push('DISCORD_CLIENT_ID is not an application id (a number of 17 to 20 digits).');
  if (config.devGuildId && !/^\d{17,20}$/.test(config.devGuildId)) problems.push('DISCORD_GUILD_ID is not a server id.');
  for (const zone of config.timezones) {
    if (!validZone(zone)) problems.push(`TIMEZONE has "${zone}", which is not a time zone. Use names like Europe/Lisbon,America/New_York.`);
  }
  return problems;
}
