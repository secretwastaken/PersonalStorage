// Times the way people type them: a span from now ("2h", "3 days", "1h30m")
// or a moment on the clock ("18:30", "tomorrow 9:00", "24/12 20:00"), read
// in the person's own time zone.

const UNITS = [
  ['w', 7 * 86_400_000, 'week'],
  ['d', 86_400_000, 'day'],
  ['h', 3_600_000, 'hour'],
  ['m', 60_000, 'minute'],
  ['s', 1_000, 'second'],
];
const WORDS = { second: 's', seconds: 's', sec: 's', secs: 's', minute: 'm', minutes: 'm', min: 'm', mins: 'm', hour: 'h', hours: 'h', hr: 'h', hrs: 'h', day: 'd', days: 'd', week: 'w', weeks: 'w' };

/** Milliseconds, or null when the text is not a duration. */
export function parseDuration(text) {
  const parts = String(text ?? '')
    .toLowerCase()
    .trim()
    .match(/(\d+(?:\.\d+)?)\s*([a-z]+)/g);
  if (!parts || parts.join('').replace(/\s/g, '') !== String(text).toLowerCase().replace(/\s/g, '')) return null;
  let total = 0;
  for (const part of parts) {
    const [, amount, word] = part.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);
    const unit = UNITS.find(([letter]) => letter === (WORDS[word] ?? word));
    if (!unit) return null;
    total += Number(amount) * unit[1];
  }
  return total > 0 ? Math.round(total) : null;
}

/** "2 hours 30 minutes", from milliseconds. */
export function formatDuration(ms) {
  const parts = [];
  let left = ms;
  for (const [, size, word] of UNITS) {
    const count = Math.floor(left / size);
    if (count > 0) {
      parts.push(`${count} ${word}${count === 1 ? '' : 's'}`);
      left -= count * size;
    }
  }
  return parts.slice(0, 2).join(' ') || '0 seconds';
}

/** Discord's relative/absolute time markup for a date. */
export const timestamp = (date, style = 'f') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

/** Whether Intl knows the zone. */
export function validTimezone(zone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock parts of an instant in a zone. */
function partsIn(date, zone) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const out = {};
  for (const part of formatter.formatToParts(date)) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return out;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(date, zone) {
  const p = partsIn(date, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which a wall-clock time happens in a zone. Found by
 * taking the time as UTC and correcting by the zone's offset, twice, which
 * settles across a daylight-saving change.
 */
export function zonedToUtc({ year, month, day, hour, minute }, zone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetAt(new Date(guess), zone);
  instant = guess - offsetAt(new Date(instant), zone);
  return new Date(instant);
}

/**
 * A moment on the clock: "18:30", "9", "tomorrow 09:00", "2026-12-24 20:00",
 * "24/12 20:00" (day/month). A bare time means today if still ahead,
 * otherwise tomorrow. Returns a Date, or null.
 */
export function parseAt(text, zone, now = new Date()) {
  const raw = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return null;
  const today = partsIn(now, zone);
  let dayShift = 0;
  let rest = raw;
  if (rest.startsWith('tomorrow')) {
    dayShift = 1;
    rest = rest.slice('tomorrow'.length).trim();
  } else if (rest.startsWith('today')) {
    rest = rest.slice('today'.length).trim();
  }
  let year = today.year;
  let month = today.month;
  let day = today.day;
  let explicitDate = false;
  const iso = rest.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(.*))?$/);
  const dm = rest.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?(?:\s+(.*))?$/);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    rest = iso[4] ?? '';
    explicitDate = true;
  } else if (dm) {
    [day, month] = [Number(dm[1]), Number(dm[2])];
    if (dm[3]) year = Number(dm[3]);
    rest = dm[4] ?? '';
    explicitDate = true;
  }
  let hour = 9;
  let minute = 0;
  if (rest) {
    const time = rest.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!time) return null;
    hour = Number(time[1]);
    minute = Number(time[2] ?? 0);
    if (time[3] === 'pm' && hour < 12) hour += 12;
    if (time[3] === 'am' && hour === 12) hour = 0;
  } else if (!explicitDate && !dayShift) {
    return null;
  }
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Day arithmetic in UTC on the calendar date, then placed in the zone.
  const date = new Date(Date.UTC(year, month - 1, day + dayShift));
  let when = zonedToUtc({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute }, zone);
  // "18:30" after half past six means tomorrow's.
  if (!explicitDate && !dayShift && when.getTime() <= now.getTime()) {
    const next = new Date(date.getTime() + 86_400_000);
    when = zonedToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour, minute }, zone);
  }
  if (Number.isNaN(when.getTime())) return null;
  return when;
}

/** The first occurrence after `now` of something due at `dueAt` and repeating every `everyMs`. */
export function nextAfter(dueAt, everyMs, now) {
  const due = new Date(dueAt).getTime();
  const at = now.getTime();
  if (due > at) return new Date(due);
  const steps = Math.floor((at - due) / everyMs) + 1;
  return new Date(due + steps * everyMs);
}

/** "every day", "every 2 weeks", "every 90 minutes". */
export function describeEvery(ms) {
  for (const [, size, word] of UNITS) {
    if (ms % size === 0) {
      const count = ms / size;
      return count === 1 ? `every ${word}` : `every ${count} ${word}s`;
    }
  }
  return `every ${formatDuration(ms)}`;
}

/** "2h", "in 3 days", "18:30" or "tomorrow 9am" as a Date, or null. */
export function parseWhen(text, zone, now = new Date()) {
  const raw = String(text ?? '').trim().toLowerCase();
  const span = parseDuration(raw.replace(/^in\s+/, ''));
  if (span) return new Date(now.getTime() + span);
  return parseAt(raw, zone, now);
}

/** "12" sets a quantity, "+3" and "-2" change it. Returns the new quantity or null. */
export function applyAmount(current, change) {
  const match = String(change ?? '').trim().match(/^([+-]?)\s*(\d{1,7})$/);
  if (!match) return null;
  const amount = Number(match[2]);
  if (match[1] === '+') return current + amount;
  if (match[1] === '-') return Math.max(0, current - amount);
  return amount;
}

/** "New York" for America/New_York. */
export const zoneLabel = (zone) => String(zone).split('/').pop().replace(/_/g, ' ');

/** "Thu 29 Oct, 18:30" as the clock on the wall in a zone. */
export function wallClock(date, zone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));
}
