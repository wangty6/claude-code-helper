import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir, userInfo, hostname } from 'os';
import { createBackup } from './backup-core.mjs';

const HOME = homedir();
const STATE_FILE = join(HOME, '.claude', 'claudefast-statusline-state.json');

const AUTOCOMPACT_BUFFER_TOKENS = 33000;
const PCT_TRIGGERS = [30, 15, 5];

const DEBOUNCE_MS = 30000; // Min 30s between backups per trigger level

function readState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    process.stderr.write(`[statusline] failed to read state: ${err.message}\n`);
  }
  return {};
}

function writeState(state) {
  const tmpFile = `${STATE_FILE}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    process.stderr.write(`[statusline] failed to write state: ${err.message}\n`);
  }
}

function shouldBackup(freeUntilCompactPct, state, sessionId) {
  if (state.sessionId !== sessionId) {
    state.sessionId = sessionId;
    state.lastBackupTimestamps = {};
    state.triggeredPctLevels = [];
    state.currentBackupPath = null;
  }

  const now = Date.now();
  const timestamps = state.lastBackupTimestamps || {};
  const triggered = state.triggeredPctLevels || [];

  for (const pct of PCT_TRIGGERS) {
    if (freeUntilCompactPct <= pct && !triggered.includes(pct)) {
      // Per-level debounce: only check this level's last backup time
      const lastForLevel = timestamps[pct] || 0;
      if (lastForLevel && (now - lastForLevel) < DEBOUNCE_MS) {
        continue;
      }

      triggered.push(pct);
      state.triggeredPctLevels = triggered;
      timestamps[pct] = now;
      state.lastBackupTimestamps = timestamps;
      return { trigger: true, type: `${pct}% remaining` };
    }
  }

  return { trigger: false, type: null };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id || '';
    const cwd = data.cwd || '';
    const model = data.model?.display_name || '';
    const remainingPct = data.context_window?.remaining_percentage;
    const windowSize = data.context_window?.context_window_size || 200000;

    const usedPct = remainingPct != null ? (100 - remainingPct) : null;
    const tokensUsed = usedPct != null ? Math.round((usedPct / 100) * windowSize) : null;
    const autocompactBufferPct = (AUTOCOMPACT_BUFFER_TOKENS / windowSize) * 100;
    const freeUntilCompactPct = remainingPct != null
      ? Math.max(0, remainingPct - autocompactBufferPct)
      : null;

    let backupPath = null;
    const state = readState();
    const stateBefore = JSON.stringify(state);

    if (freeUntilCompactPct != null) {
      const result = shouldBackup(freeUntilCompactPct, state, sessionId);
      if (result.trigger) {
        backupPath = createBackup(sessionId, result.type, remainingPct);
        if (backupPath) {
          state.currentBackupPath = backupPath;
        }
      }
      if (JSON.stringify(state) !== stateBefore) {
        writeState(state);
      }
    }

    const user = userInfo().username;
    const host = hostname().split('.')[0];

    const parts = [];
    parts.push(`\x1b[1;32m${user}@${host}\x1b[0m`);
    parts.push(':');
    parts.push(`\x1b[1;34m${cwd}\x1b[0m`);
    if (model) parts.push(` (${model})`);
    if (usedPct != null) parts.push(` [ctx:${usedPct.toFixed(0)}%]`);
    if (backupPath) parts.push(` -> ${backupPath}`);

    process.stdout.write(parts.join(''));
  } catch (e) {
    process.stdout.write(`statusline error: ${e.message}`);
  }
}

main();
