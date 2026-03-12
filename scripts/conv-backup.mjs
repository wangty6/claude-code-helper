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
    let transcriptPath = null;
    let contextPct = null;

    try {
      const data = JSON.parse(input);
      sessionId = data.session_id;
      transcriptPath = data.transcript_path || null;
      if (data.context_window?.remaining_percentage != null) {
        contextPct = data.context_window.remaining_percentage;
      }
    } catch (err) {
      process.stderr.write(`[conv-backup] failed to parse hook input: ${err.message}\n`);
    }

    if (!sessionId) {
      try {
        if (existsSync(STATE_FILE)) {
          const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
          sessionId = state.sessionId;
        }
      } catch (err) {
        process.stderr.write(`[conv-backup] failed to read state file: ${err.message}\n`);
      }
    }

    if (sessionId) {
      const backupPath = createBackup(sessionId, 'pre-compact', contextPct, transcriptPath);
      if (backupPath) {
        try {
          const content = readFileSync(backupPath, 'utf8');
          const border = '─'.repeat(60);
          process.stderr.write(`\n┌${border}┐\n`);
          process.stderr.write(`│ 📋 Context Recovery Backup (pre-compact)\n`);
          process.stderr.write(`├${border}┤\n`);
          for (const line of content.split('\n')) {
            process.stderr.write(`│ ${line}\n`);
          }
          process.stderr.write(`├${border}┤\n`);
          process.stderr.write(`│ Saved to: ${backupPath}\n`);
          process.stderr.write(`│ Use /backups to recover after compaction\n`);
          process.stderr.write(`└${border}┘\n`);
        } catch {
          // Don't fail if we can't print the summary
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[conv-backup] unexpected error: ${err.message}\n`);
  }

  console.log('{}');
}

main();
