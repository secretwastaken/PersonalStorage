// Release notes, newest first. Bump package.json to the same number when
// adding one; the bot warns at startup if the two disagree.
export const RELEASES = [
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
