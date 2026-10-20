#!/usr/bin/env node
// Prints a bcrypt hash for the deployment-wide default Director lock
// password, to paste into the DIRECTOR_LOCK_DEFAULT_HASH env var on Render.
// Every account without its own password (set in the admin panel) uses it.
//
//   node scripts/hash-director-lock.cjs            (asks for the password)
//
// The password is read from the terminal, never from the command line, so
// it does not land in the shell history.

const bcrypt = require('bcryptjs');
const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl.stdoutMuted = true;
rl._writeToOutput = function write(text) {
  if (!rl.stdoutMuted || text.includes('\n')) rl.output.write(text);
};
process.stdout.write('Default Director lock password: ');
rl.question('', async (password) => {
  rl.close();
  process.stdout.write('\n');
  if (!password || password.length < 8) {
    console.error('Use at least 8 characters.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log(`DIRECTOR_LOCK_DEFAULT_HASH=${hash}`);
});
