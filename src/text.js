import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

// Every word members read in the panels lives here, so the wording can change
// without touching how anything works.

export const COLORS = {
  panel: 0x6b7f3a,
  note: 0xd9b45a,
  item: 0x7d8c4f,
  place: 0x4f7d8c,
  journal: 0xa0785a,
  reminder: 0xb33a3a,
  done: 0x5c5c5c,
};

// The channels of a storage, in the order they appear in the category.
export const CHANNELS = [
  { kind: 'home', name: '🏠⋮home', topic: 'Your storage at a glance. Only you can see this category.' },
  { kind: 'reminders', name: '⏰⋮reminders', topic: 'Reminders the bot pings you about. /remind me' },
  { kind: 'notes', name: '📝⋮notes', topic: 'Anything worth remembering. /note add' },
  { kind: 'inventory', name: '🎒⋮inventory', topic: 'What you have and where you stashed it. /item add' },
  { kind: 'coordinates', name: '📍⋮coordinates', topic: 'Bases, loot spots and safehouses. /place add' },
  { kind: 'screenshots', name: '📸⋮screenshots', topic: 'Drop pictures here, or /screenshot add with a caption.' },
  { kind: 'journal', name: '📖⋮journal', topic: 'Your run, day by day. /journal add' },
];

export const categoryName = (user) => `${user.displayName ?? user.username}'s Personal Storage`.slice(0, 100);

export const PRIVACY = [
  'Only you can see your storage. Nobody else in the server can open it, staff included.',
  'The server belongs to an account nobody uses, so not even the bot’s owner can look inside.',
  'The bot keeps no copy of what you write: it lives in your channels and nowhere else. Its database only records which channels are yours and when your reminders are due.',
  '`/storage delete` removes the category and everything in it, for good.',
].join('\n\n');

export function setupPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.panel)
    .setTitle('🗄️ Personal Storage')
    .setDescription(
      [
        'Click the button below to create your personal storage: a private category that only you can see.',
        '',
        `It comes with channels for ${CHANNELS.slice(1).map((channel) => `**${channel.kind}**`).join(', ')}. Made for keeping track of your Project Zomboid survivor, though you can keep anything you like in it.`,
        '',
        'Write in the channels yourself, or use the commands (`/note`, `/item`, `/place`, `/remind`, `/journal`, `/screenshot`) and let the bot keep things tidy.',
      ].join('\n'),
    )
    .addFields({ name: '🔒 Your privacy', value: PRIVACY });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ps:create').setStyle(ButtonStyle.Success).setEmoji('🗄️').setLabel('Create my personal storage'),
  );
  return { embeds: [embed], components: [row] };
}

export function homePanel(user, channelIds) {
  const link = (kind) => (channelIds[kind] ? `<#${channelIds[kind]}>` : `#${kind}`);
  const embed = new EmbedBuilder()
    .setColor(COLORS.panel)
    .setTitle(`🗄️ ${categoryName(user)}`)
    .setDescription('Only you can see this category. Type in any channel yourself, or use the buttons below. The commands work from anywhere in the server, and their replies are only shown to you.')
    .addFields(
      { name: '⏰ Reminders', value: `${link('reminders')}\nThe bot pings you when one is due. \`/remind me\``, inline: true },
      { name: '📝 Notes', value: `${link('notes')}\nAnything worth remembering. \`/note add\``, inline: true },
      { name: '🎒 Inventory', value: `${link('inventory')}\nWhat you have and where. \`/item add\`, \`/item amount\``, inline: true },
      { name: '📍 Coordinates', value: `${link('coordinates')}\nX, Y and floor from the map. \`/place add\``, inline: true },
      { name: '📸 Screenshots', value: `${link('screenshots')}\nDrop pictures in, or \`/screenshot add\`.`, inline: true },
      { name: '📖 Journal', value: `${link('journal')}\nYour run, day by day. \`/journal add\``, inline: true },
      { name: 'Useful to know', value: 'Every entry the bot posts gets a number, used by `edit` and `remove`. Deleting an entry’s message by hand removes it too, and deleting a reminder cancels it. `/storage repair` brings back a channel you deleted, and `/storage timezone` sets the clock your reminders use.' },
    );
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ps:open:note').setStyle(ButtonStyle.Secondary).setEmoji('📝').setLabel('Note'),
      new ButtonBuilder().setCustomId('ps:open:item').setStyle(ButtonStyle.Secondary).setEmoji('🎒').setLabel('Item'),
      new ButtonBuilder().setCustomId('ps:open:place').setStyle(ButtonStyle.Secondary).setEmoji('📍').setLabel('Place'),
      new ButtonBuilder().setCustomId('ps:open:reminder').setStyle(ButtonStyle.Secondary).setEmoji('⏰').setLabel('Reminder'),
      new ButtonBuilder().setCustomId('ps:open:journal').setStyle(ButtonStyle.Secondary).setEmoji('📖').setLabel('Journal'),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ps:open:screenshot').setStyle(ButtonStyle.Secondary).setEmoji('📸').setLabel('Screenshot'),
      new ButtonBuilder().setCustomId('ps:info').setStyle(ButtonStyle.Secondary).setEmoji('📊').setLabel('What’s stored'),
    ),
  ];
  return { embeds: [embed], components: rows };
}
