# Personal Storage

A Discord bot that gives every member a private corner of the server. One
click on a panel builds a category called **"<name>'s Personal Storage"**
that only they can see, with a channel for each kind of thing worth keeping
track of. Made for a Project Zomboid community, though nothing in it stops
anyone from storing whatever they like.

| Channel | For |
| --- | --- |
| 🏠 home | The storage at a glance, with buttons for adding things |
| ⏰ reminders | Reminders the bot pings you about |
| 📝 notes | Anything worth remembering |
| 🎒 inventory | What you have, how many, and where you stashed it |
| 📍 coordinates | Bases, loot spots and safehouses, as X, Y and floor |
| 📸 screenshots | Pictures, with captions |
| 📖 journal | Your run, day by day |

Members can type in their channels like anywhere else. The commands are for
when they would rather not: they post tidy, numbered entries that can be
edited and removed later.

## Commands

All replies are only shown to the person who asked, and every command works
from any channel in the server.

| Command | What it does |
| --- | --- |
| `/setup` | Posts the "create your personal storage" panel in the current channel. Needs Manage Server. Running it again moves the panel |
| `/storage create` | Builds your storage (the same as the panel's button) |
| `/storage info` | What is in your storage, and your next reminder |
| `/storage timezone` | The time zone your reminders are read in |
| `/storage repair` | Brings back deleted channels, re-applies the privacy settings, and renames the category if your name changed |
| `/storage delete` | Deletes the whole storage, after asking |
| `/remind me` `when` `what` `[repeat]` `[dm]` `[zone]` | A reminder: `2h`, `30m`, `18:30`, `tomorrow 9:00`, `24/12 20:00`. Repeats take `1d`, `12h`, `1w`. `zone` says which clock a time like 18:30 is on, for this reminder only |
| `/remind list`, `/remind cancel` | The reminders waiting, and cancelling one |
| `/note add\|edit\|remove\|list` | Notes. `add` without text opens a form with room for several lines |
| `/item add\|edit\|remove\|list` | Inventory. `/item amount` sets a quantity (`12`) or changes it (`+3`, `-2`) |
| `/place add\|edit\|remove\|list` | Coordinates: a name, X, Y, an optional floor and a note |
| `/journal add\|edit\|remove\|list` | Journal entries, with an optional title like "Day 12" |
| `/screenshot add\|edit\|remove\|list` | A picture with a caption |

`edit` opens a form filled in with the entry as it is. The entry to edit or
remove is picked by number, and the list suggests them as you type.

`TIMEZONE` can list several zones, like `Europe/Lisbon,America/New_York`
for players on both sides of the Atlantic. Every reminder then shows its
time on each of those clocks, and each member picks theirs from a menu on
their home panel. Until they do, times are read on the first one.

A reminder rings in the reminders channel with a mention, and by DM too if
asked. One-off reminders can be snoozed from the ping; repeating ones can be
stopped from it.

## Privacy

Each category and channel denies **View Channel** to `@everyone` and allows
it to its owner and the bot. Nobody else is named in its permissions.

The bot keeps no copy of what people write. Entries and reminders are
messages in their own channels, and the database only holds which channels
belong to whom, the number given to each entry, and when each reminder is
due. A reminder's text is read from its message when it rings. Deleting an
entry's message by hand removes the entry, deleting a reminder cancels it,
and `/storage delete` leaves nothing behind.

A storage outlives its owner leaving the server by a week. The bot hears
the leave as it happens, and asks Discord about each owner every half hour
to catch anything that happened while it was down. Someone who comes back
within the week finds everything as they left it, and the bot re-applies
the privacy settings and their current name. After the week, the category
and its channels are deleted along with their records. Coming back never
builds a storage anyone did not ask for.

## The No Personal Storage role

Every member without a storage wears a role called **No Personal Storage**,
given when they join or rejoin and taken off the moment they make one. Use
it to point newcomers at the panel, for example with a channel only that
role can see. `/storage delete` puts it back on. The bot uses a role of that
name if the server has one, and makes it otherwise; it has to sit below the
bot's own role. At every start the bot goes through the member list and puts
the role right.

Discord itself sets two limits on that promise, and `/setup` checks both
for whoever runs it:

- **The server owner and any role with Administrator** can see every channel,
  whatever its permissions. The panel tells members the server belongs to an
  account nobody uses; keep it that way, and give staff Manage Server rather
  than Administrator.
- **The bot's token** can read what the bot can see. Keep it out of anyone
  else's hands.

## Running it

Node 22.13 or newer. There is nothing to compile: the database is the
SQLite built into Node.

1. Create an application at <https://discord.com/developers/applications>,
   add a bot, and copy its token. Switch on the **Server Members** intent
   under Bot: the role and the week a storage waits both need it.
2. `cp .env.example .env` and fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`
   and `TIMEZONE` (one zone, or several separated by commas).
3. `npm install`
4. `npm start` prints an invite link with exactly the permissions the bot
   needs. Invite it.
5. `npm run register` to tell Discord about the commands. With
   `DISCORD_GUILD_ID` set they show up in that server at once.
6. Run `/setup` in the channel that should hold the panel.

The bot needs Manage Channels and Manage Roles to build categories and set
their permissions, plus the usual message permissions. Discord allows 500
channels in a server and each storage takes eight, so a server has room for
about sixty storages; `/setup` says how many are left.

`npm test` runs the tests.

### On a server

`deploy/personalstorage.service` is a systemd unit for a checkout in
`/root/personalstorage`. After that, `bash deploy/update.sh` pulls, installs,
re-registers the commands when they changed, backs up the database, and
restarts the bot.
