import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const BACKUPS_DIR = join(HOME, '.claude', 'backups');
const PROJECTS_DIR = join(HOME, '.claude', 'projects');

function findTranscript(sessionId) {
  if (!existsSync(PROJECTS_DIR)) return null;
  const projects = readdirSync(PROJECTS_DIR, { withFileTypes: true });
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const candidate = join(PROJECTS_DIR, proj.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function parseTranscript(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const data = {
    userMessages: [],
    modifiedFiles: new Set(),
    tasks: [],
    subAgents: [],
    skills: [],
    bashCommands: [],
  };

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

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

  return { ...data, modifiedFiles: [...data.modifiedFiles] };
}

function nextBackupPath() {
  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
  const existing = readdirSync(BACKUPS_DIR).filter(f => f.match(/^\d+-backup-.*\.md$/)).length;
  const num = existing + 1;
  const now = new Date();
  const day = now.getDate();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const hour = now.getHours();
  const minute = String(now.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 || 12;
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
    : (day === 3 || day === 23) ? 'rd' : 'th';
  return join(BACKUPS_DIR, `${num}-backup-${day}${suffix}-${month}-${year}-${h12}-${minute}${ampm}.md`);
}

function formatMarkdown(sessionId, triggerType, contextPct, parsed) {
  const lines = [
    '# Context Recovery Backup', '',
    '## Session Metadata',
    `- **Session ID:** ${sessionId}`,
    `- **Trigger:** ${triggerType}`,
    `- **Context Remaining:** ${contextPct}%`,
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

export function createBackup(sessionId, triggerType, contextPct) {
  const transcriptPath = findTranscript(sessionId);
  if (!transcriptPath) return null;
  const parsed = parseTranscript(transcriptPath);
  const markdown = formatMarkdown(sessionId, triggerType, contextPct, parsed);
  const backupPath = nextBackupPath();
  writeFileSync(backupPath, markdown, 'utf8');
  return backupPath;
}
