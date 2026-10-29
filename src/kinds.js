import { EmbedBuilder } from 'discord.js';
import { COLORS } from './text.js';

// What can be stored, and how each kind looks as a message. An entry's
// content is read back from its own message when it is edited, which is why
// every kind can both render (payload) and parse (read) itself.

const excerpt = (text, length = 60) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

const embedOf = (message) => message?.embeds?.[0]?.data ?? message?.embeds?.[0] ?? {};
const fieldOf = (embed, name) => embed.fields?.find((field) => field.name === name)?.value ?? '';

export const KINDS = {
  note: {
    id: 'note',
    channel: 'notes',
    noun: 'note',
    Noun: 'Note',
    emoji: '📝',
    description: 'Notes in your notes channel',
    fields: [
      { id: 'text', label: 'Note', type: 'paragraph', max: 4000, required: true, description: 'What to remember. Leave it out to write in a bigger box.' },
      { id: 'title', label: 'Title', type: 'text', max: 100, placeholder: 'Generator fuel', description: 'A short title' },
    ],
    payload: (data, number) => ({
      embeds: [new EmbedBuilder().setColor(COLORS.note).setTitle(data.title || null).setDescription(data.text).setFooter({ text: `Note #${number}` })],
    }),
    read: (message) => {
      const embed = embedOf(message);
      return { title: embed.title ?? '', text: embed.description ?? '' };
    },
    label: (data) => data.title || excerpt(data.text),
  },

  item: {
    id: 'item',
    channel: 'inventory',
    noun: 'item',
    Noun: 'Item',
    emoji: '🎒',
    description: 'Items in your inventory channel',
    fields: [
      { id: 'name', label: 'Item', type: 'text', max: 100, required: true, slashRequired: true, placeholder: 'Canned beans', description: 'What it is' },
      { id: 'quantity', label: 'Quantity', type: 'integer', min: 0, max: 1_000_000, default: 1, description: 'How many (1 if left out)' },
      { id: 'where', label: 'Where', type: 'text', max: 100, placeholder: 'Base, kitchen fridge', description: 'Where it is kept' },
      { id: 'note', label: 'Note', type: 'paragraph', max: 1000, description: 'Anything else about it' },
    ],
    payload: (data, number) => {
      const embed = new EmbedBuilder()
        .setColor(COLORS.item)
        .setTitle(data.name)
        .addFields({ name: 'Quantity', value: `×${data.quantity}`, inline: true })
        .setFooter({ text: `Item #${number}` });
      if (data.where) embed.addFields({ name: 'Where', value: data.where, inline: true });
      if (data.note) embed.setDescription(data.note);
      return { embeds: [embed] };
    },
    read: (message) => {
      const embed = embedOf(message);
      return {
        name: embed.title ?? '',
        quantity: Number(fieldOf(embed, 'Quantity').replace(/\D/g, '')) || 0,
        where: fieldOf(embed, 'Where'),
        note: embed.description ?? '',
      };
    },
    label: (data) => `${data.name} ×${data.quantity}`,
  },

  place: {
    id: 'place',
    channel: 'coordinates',
    noun: 'place',
    Noun: 'Place',
    emoji: '📍',
    description: 'Places in your coordinates channel',
    fields: [
      { id: 'name', label: 'Name', type: 'text', max: 100, required: true, slashRequired: true, placeholder: 'Muldraugh safehouse', description: 'What is there' },
      { id: 'x', label: 'X', type: 'integer', min: 0, max: 100_000, required: true, slashRequired: true, description: 'X coordinate from the map' },
      { id: 'y', label: 'Y', type: 'integer', min: 0, max: 100_000, required: true, slashRequired: true, description: 'Y coordinate from the map' },
      { id: 'floor', label: 'Floor', type: 'integer', min: -32, max: 32, default: 0, description: 'Floor, 0 for the ground (0 if left out)' },
      { id: 'note', label: 'Note', type: 'paragraph', max: 1000, description: 'Anything else about it' },
    ],
    payload: (data, number) => {
      const embed = new EmbedBuilder()
        .setColor(COLORS.place)
        .setTitle(data.name)
        .addFields(
          { name: 'X', value: String(data.x), inline: true },
          { name: 'Y', value: String(data.y), inline: true },
          { name: 'Floor', value: String(data.floor), inline: true },
        )
        .setFooter({ text: `Place #${number} · ${data.x},${data.y},${data.floor}` });
      if (data.note) embed.setDescription(data.note);
      return { embeds: [embed] };
    },
    read: (message) => {
      const embed = embedOf(message);
      return {
        name: embed.title ?? '',
        x: Number(fieldOf(embed, 'X')) || 0,
        y: Number(fieldOf(embed, 'Y')) || 0,
        floor: Number(fieldOf(embed, 'Floor')) || 0,
        note: embed.description ?? '',
      };
    },
    label: (data) => `${data.name} (${data.x}, ${data.y})`,
  },

  journal: {
    id: 'journal',
    channel: 'journal',
    noun: 'entry',
    Noun: 'Journal entry',
    emoji: '📖',
    description: 'Entries in your journal channel',
    fields: [
      { id: 'text', label: 'Entry', type: 'paragraph', max: 4000, required: true, description: 'What happened. Leave it out to write in a bigger box.' },
      { id: 'title', label: 'Title', type: 'text', max: 100, placeholder: 'Day 12', description: 'A title, like the day of your run' },
    ],
    payload: (data, number) => ({
      embeds: [new EmbedBuilder().setColor(COLORS.journal).setTitle(data.title || null).setDescription(data.text).setFooter({ text: `Journal #${number}` })],
    }),
    read: (message) => {
      const embed = embedOf(message);
      return { title: embed.title ?? '', text: embed.description ?? '' };
    },
    label: (data) => data.title || excerpt(data.text),
  },

  screenshot: {
    id: 'screenshot',
    channel: 'screenshots',
    noun: 'screenshot',
    Noun: 'Screenshot',
    emoji: '📸',
    description: 'Screenshots in your screenshots channel',
    fields: [
      { id: 'image', label: 'Picture', type: 'file', required: true, slashRequired: true, description: 'The picture to keep' },
      { id: 'caption', label: 'Caption', type: 'text', max: 500, placeholder: 'The horde at the gas station', description: 'A caption' },
    ],
    // A plain message rather than an embed, so the picture shows at full size
    // and an edit never has to touch the attachment.
    payload: (data, number) => {
      const message = { content: `**📸 Screenshot #${number}**${data.caption ? `\n${data.caption}` : ''}` };
      if (data.image) message.files = [{ attachment: data.image.url, name: data.image.name }];
      return message;
    },
    read: (message) => ({ caption: String(message?.content ?? '').split('\n').slice(1).join('\n') }),
    label: (data) => excerpt(data.caption) || 'No caption',
  },
};

export const kindByChannel = Object.fromEntries(Object.values(KINDS).map((kind) => [kind.channel, kind]));

/**
 * Turns raw input (slash options or form answers) into an entry's data.
 * Fields that are not given keep what `base` has, which is how an edit only
 * changes what the person touched. Returns { data } or { error }.
 */
export function parseFields(kind, values, base = {}) {
  const data = { ...base };
  for (const field of kind.fields) {
    const given = values[field.id];
    if (field.type === 'file') {
      if (given === undefined) continue;
      if (!given) return { error: `${field.label} is missing.` };
      const type = String(given.contentType ?? '');
      if (!type.startsWith('image/') && !/\.(png|jpe?g|gif|webp)$/i.test(given.name ?? '')) return { error: 'That file is not a picture. PNG, JPG, GIF and WebP work.' };
      data[field.id] = given;
      continue;
    }
    if (given === undefined || given === null) {
      if (data[field.id] === undefined) data[field.id] = field.type === 'integer' ? field.default ?? null : '';
    } else if (field.type === 'integer') {
      const raw = String(given).trim();
      if (raw === '') data[field.id] = field.default ?? null;
      else if (!/^-?\d+$/.test(raw)) return { error: `${field.label} has to be a whole number.` };
      else data[field.id] = Number(raw);
    } else {
      data[field.id] = String(given).trim().slice(0, field.max);
    }
    const value = data[field.id];
    if (field.type === 'integer' && value !== null && (value < field.min || value > field.max)) {
      return { error: `${field.label} has to be between ${field.min} and ${field.max}.` };
    }
  }
  // A picture is checked above when it is given; an edit never carries one.
  for (const field of kind.fields) {
    if (field.type === 'file') continue;
    const value = data[field.id];
    if (field.required && (value === null || value === undefined || value === '')) return { error: `${field.label} is empty.` };
  }
  return { data };
}

/** The fields the slash command did not fill and that are required, so a form has to ask. */
export const missingRequired = (kind, values) => kind.fields.filter((field) => field.required && field.type !== 'file' && (values[field.id] === undefined || values[field.id] === null || values[field.id] === ''));
