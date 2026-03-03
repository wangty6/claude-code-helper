import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createBackup } from './backup-core.mjs';

const HOME = homedir();
const STATE_FILE = join(HOME, '.claude', 'claudefast-statusline-state.json');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    let sessionId = null;
    try {
      const data = JSON.parse(input);
      sessionId = data.session_id;
    } catch {}

    if (!sessionId) {
      try {
        if (existsSync(STATE_FILE)) {
          const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
          sessionId = state.sessionId;
        }
      } catch {}
    }

    if (sessionId) {
      createBackup(sessionId, 'pre-compact', 'unknown');
    }
  } catch {}

  console.log('{}');
}

main();
