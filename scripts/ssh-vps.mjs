// Open a shell on the VPS, or run one command there, using the connection
// details already in .env - so "do X on the VPS" never requires remembering a
// hostname, a key path or where the app lives.
//
// Run these FROM THE REPO ROOT on the laptop (C:\Claude\community-bus-maps):
//
//   npm run ssh                              open an interactive shell, already
//                                            cd'd into the app directory
//   npm run ssh -- "docker compose ps"       run one command there and come back
//   npm run ssh -- --print "whatever"        print the ssh command, connect to
//                                            nothing (for checking/pasting)
//
// Quote the whole remote command as ONE argument. Everything after `--` goes to
// this script rather than to npm.
//
// Reads DEPLOY_HOST, DEPLOY_SSH_KEY (optional) and DEPLOY_APP_DIR from .env via
// the --env-file-if-exists flag in package.json. No BatchMode here, unlike
// deliver-map.mjs: this one is meant to be used by a human who may need to
// answer a passphrase prompt.

import { spawnSync } from 'node:child_process';

const HOST = process.env.DEPLOY_HOST;
const KEY = process.env.DEPLOY_SSH_KEY;
const APP_DIR = process.env.DEPLOY_APP_DIR;

if (!HOST || !APP_DIR) {
  console.error('DEPLOY_HOST and DEPLOY_APP_DIR must be set in .env (see .env.example).');
  console.error('  DEPLOY_HOST=user@host   DEPLOY_APP_DIR=/opt/community-bus-maps');
  process.exit(1);
}

// MSYS (Git Bash) rewrites a POSIX-looking absolute path in an argv or an
// inline env assignment into a Windows one, so `DEPLOY_APP_DIR=/opt/x npm run
// ssh` silently becomes C:/.../Git/opt/x and the remote `cd` then fails with a
// confusing "no such directory" about a path the VPS has never heard of.
// .env.example already warns about this for deliver-map.mjs; catch it here
// rather than let it surface as a remote error. Reading from .env is unaffected.
if (!APP_DIR.startsWith('/')) {
  console.error(`DEPLOY_APP_DIR is "${APP_DIR}", which is not an absolute POSIX path.`);
  console.error('If you set it inline in Git Bash, MSYS rewrote it -- put it in .env instead');
  console.error('and run `npm run ssh` from the repo root (C:/Claude/community-bus-maps).');
  process.exit(1);
}

const argv = process.argv.slice(2);
const printOnly = argv[0] === '--print';
const rest = printOnly ? argv.slice(1) : argv;
const remoteCmd = rest.join(' ').trim();

const args = [];
if (KEY) args.push('-i', KEY);
// -t forces a TTY so an interactive shell (and anything that wants one, like a
// pager or a confirmation prompt) behaves normally through ssh.
args.push('-t', HOST);
args.push(remoteCmd ? `cd ${APP_DIR} && ${remoteCmd}` : `cd ${APP_DIR} && exec $SHELL -l`);

if (printOnly) {
  console.log('ssh ' + args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '));
  process.exit(0);
}

console.log(`-> ${HOST}:${APP_DIR}${remoteCmd ? `  $ ${remoteCmd}` : '  (interactive shell)'}`);
const r = spawnSync('ssh', args, { stdio: 'inherit' });
if (r.error) { console.error(r.error.message); process.exit(1); }
process.exit(r.status ?? 1);
