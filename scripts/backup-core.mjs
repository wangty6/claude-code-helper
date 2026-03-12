import { readFileSync, writeFileSync, readdirSync, mkdirSync, openSync, closeSync, readSync, statSync, unlinkSync, constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const BACKUPS_DIR = join(HOME, '.claude', 'backups');
const PROJECTS_DIR = join(HOME, '.claude', 'projects');

const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_BACKUPS = 50;
const MAX_BACKUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEDUP_WINDOW_MS = 60 * 1000; // 60 seconds

function findTranscript(sessionId) {
  let projects;
  try {
    projects = readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const candidate = join(PROJECTS_DIR, proj.name, `${sessionId}.jsonl`);
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // not in this project dir
    }
  }
  return null;
}

function emptyTranscriptData() {
  return {
    userMessages: [],
    modifiedFiles: [],
    tasks: [],
    subAgents: [],
    skills: [],
    bashCommands: [],
  };
}

function parseTranscript(filePath) {
  // Size guard
  try {
    const size = statSync(filePath).size;
    if (size > MAX_TRANSCRIPT_BYTES) {
      process.stderr.write(`[backup-core] transcript too large (${(size / 1024 / 1024).toFixed(1)} MB), skipping parse\n`);
      return emptyTranscriptData();
    }
  } catch (err) {
    process.stderr.write(`[backup-core] cannot stat transcript: ${err.message}\n`);
    return emptyTranscriptData();
  }

  const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const data = { ...emptyTranscriptData(), modifiedFiles: new Set() };

  let parseFailures = 0;

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { parseFailures++; continue; }

    if (entry.type === 'user') {
      const msg = entry.message;
      if (typeof msg === 'string') {
        data.userMessages.push(msg.slice(0, 500));
      } else if (msg && typeof msg.content === 'string') {
        data.userMessages.push(msg.content.slice(0, 500));
      } else if (msg && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            data.userMessages.push(block.text.slice(0, 500));
          }
        }
      }
    }

    if (entry.type === 'assistant' && entry.message?.content) {
      const content = Array.isArray(entry.message.content) ? entry.message.content : [];
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const name = block.name || '';
        const input = block.input || {};

        if ((name === 'Write' || name === 'Edit') && input.file_path) {
          data.modifiedFiles.add(input.file_path);
        }
        if (name === 'TaskCreate') {
          data.tasks.push({ op: 'create', subject: input.subject || '', status: 'pending' });
        }
        if (name === 'TaskUpdate') {
          data.tasks.push({ op: 'update', taskId: input.taskId, status: input.status || '' });
        }
        if (name === 'Task' || name === 'Agent') {
          data.subAgents.push({
            type: input.subagent_type || input.type || 'unknown',
            description: (input.description || input.prompt || '').slice(0, 200),
          });
        }
        if (name === 'Skill') {
          data.skills.push(input.skill || input.name || 'unknown');
        }
        if (name === 'Bash' && input.command) {
          const cmd = input.command;
          if (/\b(test|pytest|jest|make|build|npm run|yarn|cargo|go test|lint)\b/i.test(cmd)) {
            data.bashCommands.push(cmd.slice(0, 300));
          }
        }
      }
    }
  }

  if (parseFailures > 0) {
    process.stderr.write(`[backup-core] ${parseFailures} JSONL line(s) failed to parse\n`);
  }

  return { ...data, modifiedFiles: [...data.modifiedFiles] };
}

/**
 * List all backup .md files with their mtime. Shared by dedup and cleanup.
 * Returns array sorted newest-first, or empty array if dir doesn't exist.
 */
function listBackups() {
  let names;
  try {
    names = readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
  return names
    .map(f => {
      const fullPath = join(BACKUPS_DIR, f);
      try {
        return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Read only the first `len` bytes of a file (avoids loading entire file).
 */
function readHead(filePath, len) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(len);
    const bytesRead = readSync(fd, buf, 0, len, 0);
    return buf.toString('utf8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function reserveBackupPath() {
  mkdirSync(BACKUPS_DIR, { recursive: true });

  const now = new Date();
  // ISO-based name: backup-2026-03-12T08-30-45-123Z.md
  const ts = now.toISOString().replace(/:/g, '-').replace(/\./g, '-');
  const baseName = `backup-${ts}.md`;
  const fullPath = join(BACKUPS_DIR, baseName);

  try {
    // Atomic create — fails if file already exists
    const fd = openSync(fullPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    closeSync(fd);
    return fullPath;
  } catch {
    // Collision (extremely unlikely with ms precision) — retry with pid suffix
    const fallbackName = `backup-${ts}-${process.pid}.md`;
    const fallbackPath = join(BACKUPS_DIR, fallbackName);
    const fd = openSync(fallbackPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    closeSync(fd);
    return fallbackPath;
  }
}

function cleanupOldBackups(backupFiles) {
  const now = Date.now();
  for (let i = 0; i < backupFiles.length; i++) {
    const shouldDelete = i >= MAX_BACKUPS || (now - backupFiles[i].mtime) > MAX_BACKUP_AGE_MS;
    if (shouldDelete) {
      try {
        unlinkSync(backupFiles[i].path);
      } catch (err) {
        process.stderr.write(`[backup-core] failed to delete old backup ${backupFiles[i].path}: ${err.message}\n`);
      }
    }
  }
}

function formatMarkdown(sessionId, triggerType, contextPct, parsed) {
  const pctDisplay = contextPct != null ? contextPct.toFixed(1) + '%' : 'unknown';
  const lines = [
    '# Context Recovery Backup', '',
    '## Session Metadata',
    `- **Session ID:** ${sessionId}`,
    `- **Trigger:** ${triggerType}`,
    `- **Context Remaining:** ${pctDisplay}`,
    `- **Timestamp:** ${new Date().toISOString()}`, '',
  ];

  if (parsed.userMessages.length > 0) {
    lines.push('## User Requests');
    for (const msg of parsed.userMessages) {
      const clean = msg.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (clean) lines.push(`- ${clean.replace(/\n/g, ' ').slice(0, 200)}`);
    }
    lines.push('');
  }

  if (parsed.modifiedFiles.length > 0) {
    lines.push('## Modified Files');
    for (const f of parsed.modifiedFiles) lines.push(`- ${f}`);
    lines.push('');
  }

  if (parsed.tasks.length > 0) {
    lines.push('## Tasks');
    for (const t of parsed.tasks) {
      if (t.op === 'create') lines.push(`- [created] ${t.subject}`);
      else lines.push(`- [${t.status}] task #${t.taskId}`);
    }
    lines.push('');
  }

  if (parsed.skills.length > 0) {
    lines.push('## Skills Loaded');
    for (const s of [...new Set(parsed.skills)]) lines.push(`- ${s}`);
    lines.push('');
  }

  if (parsed.subAgents.length > 0) {
    lines.push('## Sub-Agent Calls');
    for (const a of parsed.subAgents) lines.push(`- ${a.type}: ${a.description}`);
    lines.push('');
  }

  if (parsed.bashCommands.length > 0) {
    lines.push('## Build/Test Commands');
    for (const c of parsed.bashCommands) lines.push(`- \`${c}\``);
    lines.push('');
  }

  return lines.join('\n');
}

export function createBackup(sessionId, triggerType, contextPct, transcriptPath = null) {
  const resolvedPath = transcriptPath || findTranscript(sessionId);
  if (!resolvedPath) return null;

  // Single directory scan for both dedup check and cleanup
  const backupFiles = listBackups();

  // Dedup: skip if a backup for this session was created in the last 60s
  const now = Date.now();
  for (const file of backupFiles) {
    if ((now - file.mtime) > DEDUP_WINDOW_MS) break; // sorted newest-first, so stop early
    const head = readHead(file.path, 500);
    if (head.includes(sessionId)) {
      process.stderr.write(`[backup-core] skipping duplicate backup for session ${sessionId.slice(0, 8)}...\n`);
      return null;
    }
  }

  const parsed = parseTranscript(resolvedPath);
  const markdown = formatMarkdown(sessionId, triggerType, contextPct, parsed);
  const backupPath = reserveBackupPath();
  writeFileSync(backupPath, markdown, 'utf8');

  // Only run cleanup when count exceeds threshold
  if (backupFiles.length >= MAX_BACKUPS) {
    cleanupOldBackups(backupFiles);
  }

  return backupPath;
}
