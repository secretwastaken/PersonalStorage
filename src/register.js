import { REST, Routes } from 'discord.js';
import { COMMANDS } from './commands.js';
import { config, configProblems } from './config.js';

// Tells Discord which slash commands the bot has. Run it after installing and
// whenever a command changes: Discord only knows what it was told.

const problems = configProblems();
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

const body = COMMANDS.map((command) => command.data.toJSON());
const route = config.devGuildId ? Routes.applicationGuildCommands(config.clientId, config.devGuildId) : Routes.applicationCommands(config.clientId);

try {
  await new REST().setToken(config.token).put(route, { body });
} catch (error) {
  if (error.status === 401) console.error('Discord refused the token. Check DISCORD_TOKEN in .env.');
  else if (error.code === 50001) console.error('The bot is not in that server. Invite it first, then register again.');
  else console.error(`Discord did not take the commands: ${error.message}`);
  process.exit(1);
}
console.log(`${body.length} commands registered ${config.devGuildId ? `in server ${config.devGuildId}` : 'everywhere (Discord can take up to an hour to show them)'}: ${body.map((command) => `/${command.name}`).join(' ')}`);
