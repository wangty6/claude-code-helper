# claude-code-helper

Claude Code plugin with safety hooks and context recovery utilities.

## Features

### 1. Dangerous Command Blocking (PreToolUse)

Blocks dangerous Bash commands before execution. Three safety levels:

| Level | What it blocks |
|-------|---------------|
| `critical` | `rm -rf ~/`, `dd of=/dev/sda`, fork bombs, `mkfs` |
| `high` (default) | + `curl | sh`, force push main, `git reset --hard`, secrets exposure |
| `strict` | + any force push, `sudo rm`, `docker prune`, `git checkout .` |

Configure via environment variable:
```bash
export CLAUDE_SAFETY_LEVEL=strict  # or critical, high (default)
```

### 2. Context Recovery Backup (PreCompact)

Automatically saves a markdown summary of your session before context compaction:
- User requests
- Modified files
- Tasks created/updated
- Sub-agent calls
- Build/test commands

Backups are saved to `~/.claude/backups/`.

### 3. StatusLine Monitor (manual setup)

Shows context usage percentage in the status line and triggers backups at 30%, 15%, and 5% remaining context.

## Installation

### Option A: Plugin Marketplace (recommended)

```bash
# In Claude Code, run:
/plugin marketplace add wangty6/claude-code-helper
/plugin install claude-code-helper
```

After installation, the plugin files are located at:
```
~/.claude/plugins/cache/claude-code-helper/claude-code-helper/1.0.0/
```

### Option B: Local testing

```bash
claude --plugin-dir ~/path/to/your/local/claude-code-helper
```

### StatusLine Setup (optional, manual)

The StatusLine feature cannot be auto-installed via plugins. Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/cache/claude-code-helper/claude-code-helper/1.0.0/scripts/statusline-monitor.mjs"
  }
}
```

## Logs

Blocked commands are logged to `~/.claude/hooks-logs/YYYY-MM-DD.jsonl`.
