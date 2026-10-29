// Release notes, newest first. Bump package.json to the same number when
// adding one; the bot warns at startup if the two disagree.
export const RELEASES = [
  {
    version: '1.2.0',
    date: '2026-10-29',
    changes: [
      'If you leave the server, your storage waits a week for you. Come back within it and everything is where you left it, under your current name.',
      'A storage whose owner has been gone for a week is deleted, category and channels alike.',
      'Nobody is given a storage they did not ask for: coming back only gives back one you already had.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-29',
    changes: [
      'The server can run on more than one clock: TIMEZONE takes a list, Europe/Lisbon,America/New_York here.',
      'Every reminder shows its time in Lisbon and in New York, as well as in your own Discord time.',
      'Your home panel has a menu for picking your clock, and /remind me and the reminder form can set the clock for one reminder.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-29',
    changes: [
      'A button that builds you a private category with channels for reminders, notes, inventory, coordinates, screenshots and a journal.',
      'Commands to keep each of them tidy: /note, /item, /place, /journal, /screenshot and /remind, each with add, edit, remove and list.',
      'Reminders ping you in your own channel, optionally by DM too, can repeat, and can be snoozed.',
      '/setup posts the panel and tells whoever runs it if anyone could see into a storage.',
    ],
  },
];
