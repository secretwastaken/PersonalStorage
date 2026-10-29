import { FileUploadBuilder, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import * as store from './store.js';
import { isEmpty, look } from './storage.js';

export const EPHEMERAL = MessageFlags.Ephemeral;

/** Answers privately, whatever state the interaction is in. */
export async function say(interaction, content) {
  const payload = typeof content === 'string' ? { content } : content;
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: EPHEMERAL });
}

export function noStorageText(guildId) {
  const panel = store.panel(guildId);
  const where = panel ? ` Press the button in <#${panel.channel_id}>, or use` : ' Use';
  return `You don’t have a personal storage yet.${where} \`/storage create\`.`;
}

/**
 * The caller's storage, with the channel `channelKind` checked to still exist.
 * Answers the person and returns null when either is missing.
 */
export async function storageFor(interaction, channelKind = null) {
  const found = await look(interaction.guild, interaction.user.id);
  if (!found || isEmpty(found)) {
    await say(interaction, noStorageText(interaction.guildId));
    return null;
  }
  if (channelKind && !found.channels[channelKind]) {
    await say(interaction, `Your #${channelKind} channel is gone. \`/storage repair\` makes it again.`);
    return null;
  }
  return found;
}

/** A form built from field specs (the same ones kinds.js uses), with `values` filled in. */
export function form(customId, title, fields, values = {}) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
  for (const field of fields) {
    const label = new LabelBuilder().setLabel(field.label.slice(0, 45));
    if (field.hint) label.setDescription(field.hint.slice(0, 100));
    if (field.type === 'file') {
      label.setFileUploadComponent(new FileUploadBuilder().setCustomId(field.id).setMinValues(1).setMaxValues(1).setRequired(true));
    } else if (field.type === 'select') {
      label.setStringSelectMenuComponent(field.build());
    } else {
      const input = new TextInputBuilder()
        .setCustomId(field.id)
        .setStyle(field.type === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(Boolean(field.required))
        .setMaxLength(field.type === 'integer' ? 7 : field.max);
      if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100));
      const value = values[field.id];
      if (value !== undefined && value !== null && String(value) !== '') input.setValue(String(value).slice(0, field.type === 'integer' ? 7 : field.max));
      label.setTextInputComponent(input);
    }
    modal.addLabelComponents(label);
  }
  return modal;
}

/** The answers of a submitted form, by field id. */
export function answers(interaction, fields) {
  const values = {};
  for (const field of fields) {
    if (field.type === 'file') values[field.id] = interaction.fields.getUploadedFiles(field.id, false)?.first() ?? null;
    else if (field.type === 'select') values[field.id] = interaction.fields.getStringSelectValues(field.id)[0] ?? null;
    else values[field.id] = interaction.fields.getTextInputValue(field.id);
  }
  return values;
}

/**
 * Makes sure the messages behind `rows` are in the channel's cache, fetching
 * the latest hundred once if any is missing, so labels can be read from them.
 */
export async function warmCache(channel, rows) {
  if (!channel) return;
  if (rows.some((row) => !channel.messages.cache.has(row.message_id))) await channel.messages.fetch({ limit: 100 }).catch(() => null);
}

export const excerpt = (text, length = 60) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

export const messageUrl = (guildId, channelId, messageId) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
