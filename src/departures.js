import { Events } from 'discord.js';
import * as store from './store.js';
import { deleteStorage, repairStorage } from './storage.js';

// A storage waits this long for an owner who left, so somebody who left by
// mistake, or was kicked and let back in, finds everything as it was.
export const GRACE_MS = 7 * 86_400_000;

// Leaving is noticed by asking Discord about each owner in turn rather than
// by listening for it: hearing joins and leaves takes the privileged Server
// Members intent, and every half hour is soon enough when the wait is a week.
export const CHECK_MS = 30 * 60_000;

// Discord's answers for somebody who is not in the server, and for an
// account that no longer exists.
const GONE = new Set([10007, 10013]);

/** The member if they are in the server, false if they are not, null if Discord could not say. */
async function memberOf(guild, userId) {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (error) {
    return GONE.has(error.code) ? false : null;
  }
}

/**
 * A storage owner who came back gets it as they left it: the wait ends, and
 * a repair re-applies the privacy settings and their current name.
 */
export async function welcomeBack(guild, user) {
  store.setLeft(guild.id, user.id, null);
  await repairStorage(guild, user).catch((error) => console.error(`Could not repair the storage of ${user.id} on their return:`, error));
}

/** Notes who has left, deletes the storages whose week is up, and welcomes back whoever returned. */
export async function check(guild, now = Date.now()) {
  for (const row of store.storages(guild.id)) {
    const member = await memberOf(guild, row.user_id);
    if (member === null) continue;
    if (member) {
      if (row.left_at) await welcomeBack(guild, member.user);
      continue;
    }
    if (!row.left_at) {
      store.setLeft(guild.id, row.user_id, now);
      continue;
    }
    if (now - Date.parse(row.left_at) >= GRACE_MS) {
      await deleteStorage(guild, row.user_id);
      console.log(`Deleted the storage of ${row.user_id} in ${guild.name ?? guild.id}: they left a week ago and did not come back.`);
    }
  }
}

let checking = false;

async function checkAll(client) {
  if (checking) return;
  checking = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      if (guild.available === false) continue;
      await check(guild).catch((error) => console.error(`Could not check who left ${guild.name}:`, error));
    }
  } finally {
    checking = false;
  }
}

export function startDepartures(client) {
  client.once(Events.ClientReady, () => {
    checkAll(client);
    setInterval(() => checkAll(client), CHECK_MS).unref?.();
  });
}
