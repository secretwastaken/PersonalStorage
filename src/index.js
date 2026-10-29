import { Client, Events, GatewayIntentBits, OAuth2Scopes, Partials, PermissionsBitField } from 'discord.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RELEASES } from './changelog.js';
import { byName, confirmDelete, create, info } from './commands.js';
import { ROOT, config, configProblems } from './config.js';
import * as entries from './entries.js';
import { KINDS } from './kinds.js';
import * as reminders from './reminders.js';
import { BOT_PERMISSIONS } from './storage.js';
import * as store from './store.js';
import { EPHEMERAL, storageFor } from './ui.js';

const problems = configProblems();
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
if (RELEASES[0]?.version !== version) console.warn(`package.json says ${version} but the newest release in src/changelog.js is ${RELEASES[0]?.version}. Bump them together.`);

// Guild Messages is only here for delete events. The bot never needs to read
// what people type, so Message Content stays off.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.Channel],
});

client.once(Events.ClientReady, (ready) => {
  console.log(`${ready.user.tag} (Personal Storage ${version}) is online in ${ready.guilds.cache.size} server(s).`);
  const invite = ready.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: new PermissionsBitField(BOT_PERMISSIONS) });
  console.log(`Invite: ${invite}`);
});

async function onButton(interaction) {
  const [, action, ...rest] = interaction.customId.split(':');
  if (action === 'create') return create(interaction);
  if (action === 'info') return info(interaction);
  if (action === 'delete') return confirmDelete(interaction, rest[0]);
  if (action === 'snooze') return reminders.snooze(interaction, rest[0], rest[1]);
  if (action === 'done') return reminders.done(interaction, rest[0]);
  if (action === 'stop') return reminders.stop(interaction, rest[0]);
  if (action === 'open') {
    if (rest[0] === 'reminder') {
      if (await storageFor(interaction, 'reminders')) await interaction.showModal(reminders.reminderForm());
      return;
    }
    const kind = KINDS[rest[0]];
    if (kind && (await storageFor(interaction, kind.channel))) await interaction.showModal(entries.newForm(kind));
  }
}

async function onForm(interaction) {
  const [, action, kindId, number] = interaction.customId.split(':');
  if (action === 'new' && kindId === 'reminder') return reminders.submitForm(interaction);
  const kind = KINDS[kindId];
  if (!kind) return;
  if (action === 'new') return entries.submitNew(interaction, kind);
  if (action === 'edit') return entries.submitEdit(interaction, kind, Number(number));
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  try {
    if (interaction.isButton() && interaction.customId.startsWith('ps:')) return await onButton(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ps:')) return await onForm(interaction);
    const command = interaction.commandName ? byName.get(interaction.commandName) : null;
    if (!command) return;
    if (interaction.isAutocomplete()) return await command.autocomplete?.(interaction);
    if (interaction.isChatInputCommand()) return await command.execute(interaction);
  } catch (error) {
    console.error(`Interaction ${interaction.customId ?? `/${interaction.commandName}`} failed:`, error);
    if (!interaction.isRepliable()) return;
    const apology = { content: 'Something went wrong on my side. It’s in the bot’s log.', flags: EPHEMERAL };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(apology);
      else await interaction.reply(apology);
    } catch {
      // The interaction expired; there is nobody left to tell.
    }
  }
});

// Deleting an entry's message or a whole channel by hand is a normal way of
// tidying up, so the records follow instead of pointing at nothing.
client.on(Events.MessageDelete, (message) => store.forgetMessage(message.id));
client.on(Events.MessageBulkDelete, (messages) => {
  for (const id of messages.keys()) store.forgetMessage(id);
});
client.on(Events.ChannelDelete, (channel) => store.forgetChannel(channel.id));

// A server that removes the bot keeps nothing of it.
client.on(Events.GuildDelete, (guild) => {
  if (guild.available === false) return;
  for (const row of store.storages(guild.id)) store.dropStorage(guild.id, row.user_id);
});

reminders.startClock(client);

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

try {
  await client.login(config.token);
} catch (error) {
  if (error.code === 'TokenInvalid') console.error('Discord refused the token. Check DISCORD_TOKEN in .env.');
  else console.error(`Could not log in: ${error.message}`);
  process.exit(1);
}
