import * as store from './store.js';

// Members without a storage wear this role, so the server can point them at
// the panel: a channel only they see, say. It goes the moment they make one.
export const NO_STORAGE_ROLE = 'No Personal Storage';

// Startup asks for the role from more than one place at once, and two asks
// for a role that does not exist yet must not make two.
const finding = new Map();

/**
 * The role, found by the id last used, then by name, and made if the server
 * has neither. Null if it cannot be made, or sits where the bot cannot hand
 * it out.
 */
export function noStorageRole(guild) {
  if (!finding.has(guild.id)) finding.set(guild.id, findRole(guild).finally(() => finding.delete(guild.id)));
  return finding.get(guild.id);
}

async function findRole(guild) {
  const known = store.noStorageRole(guild.id);
  let role = (known && guild.roles.cache.get(known)) || guild.roles.cache.find((each) => each.name.toLowerCase() === NO_STORAGE_ROLE.toLowerCase());
  if (!role) {
    role = await guild.roles.create({ name: NO_STORAGE_ROLE, permissions: [], mentionable: false, reason: 'Marks the members who have no personal storage yet' }).catch((error) => {
      console.error(`Could not make the ${NO_STORAGE_ROLE} role in ${guild.name}:`, error.message);
      return null;
    });
  }
  if (!role) return null;
  if (role.id !== known) store.setNoStorageRole(guild.id, role.id);
  if (!role.editable) {
    console.error(`The ${role.name} role in ${guild.name} sits above the bot's own, so the bot cannot hand it out. Move the bot's role above it.`);
    return null;
  }
  return role;
}

/** Puts the role on a member without a storage and takes it off one with a storage. */
export async function markMember(member, role = null) {
  if (member.user?.bot) return;
  role ??= await noStorageRole(member.guild);
  if (!role) return;
  const wants = !store.storage(member.guild.id, member.id);
  if (wants === member.roles.cache.has(role.id)) return;
  const reason = wants ? 'Has no personal storage' : 'Has a personal storage';
  await (wants ? member.roles.add(role, reason) : member.roles.remove(role, reason)).catch((error) => console.error(`Could not ${wants ? 'give' : 'take'} the ${role.name} role ${wants ? 'to' : 'from'} ${member.id}:`, error.message));
}

/** The same, by id, for code that only has the user. The member is read fresh from Discord. */
export async function markUser(guild, userId) {
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (member) await markMember(member);
}

/**
 * Brings every member in line at startup: the role for everyone without a
 * storage, including whoever was here before the role existed, and off
 * everyone with one. One member at a time, since after the first run there
 * is next to nothing to change.
 */
export async function markEveryone(guild) {
  const role = await noStorageRole(guild);
  if (!role) return;
  const members = await guild.members.fetch();
  for (const member of members.values()) await markMember(member, role);
}
