# claude-code-helper

> Safety rails, context recovery, and code review for Claude Code — so your AI assistant builds instead of breaks.

Your AI coding assistant has root-level shell access. It can `rm -rf ~/`, force-push over main, or `curl | sh` a stranger's script — and it will, if the prompt is wrong. **claude-code-helper** is a Claude Code plugin that catches dangerous commands before they execute, saves your session context before it's lost to compaction, and gets a second AI to review the code before you ship it.

## Why You Need This

| Problem | What happens | How this plugin helps |
|---------|-------------|----------------------|
| **Dangerous commands slip through** | One bad `rm -rf`, `dd`, or force-push and your day is ruined | Blocks 30+ dangerous patterns across 3 safety levels *before* execution |
| **Context vanishes on compaction** | Claude hits the token limit, compacts, and forgets what you were doing | Auto-saves structured session summaries at 30%, 15%, and 5% remaining context |
| **No second pair of eyes** | Claude writes code, Claude reviews code — same blind spots | Routes your code to a *different* AI model for independent review |

## Quick Start

```bash
# In Claude Code:
/plugin marketplace add wangty6/claude-code-helper
/plugin install claude-code-helper
```

That's it. Dangerous command blocking and context backups are active immediately.

## Features

### Dangerous Command Blocking

Intercepts hazardous Bash commands at the PreToolUse hook — before they run. Three escalating safety levels:

| Level | What it blocks |
|-------|---------------|
| `critical` | `rm -rf ~/`, `dd of=/dev/sda`, fork bombs, `mkfs` |
| `high` (default) | + `curl \| sh`, force push main, `git reset --hard`, secrets exposure |
| `strict` | + any force push, `sudo rm`, `docker prune`, `git checkout .` |

Configure via environment variable:
```bash
export CLAUDE_SAFETY_LEVEL=strict  # or critical, high (default)
```

Blocked commands are logged to `~/.claude/hooks-logs/YYYY-MM-DD.jsonl`.

### Context Recovery Backup

Automatically saves a markdown summary of your session before context compaction:
- User requests
- Modified files
- Tasks created/updated
- Sub-agent calls
- Build/test commands

Backups are saved to `~/.claude/backups/`.

### StatusLine Monitor

Shows context usage percentage in the status line and triggers backups at 30%, 15%, and 5% remaining context.

> **Note:** Requires manual setup — see [StatusLine Setup](#statusline-setup-optional-manual) below.

### Second Opinion Code Review

Sends Claude's plans and code to another AI model for independent review. Triggered manually via the `/second-opinion` slash command.

**How it works:**
1. Reads the conversation transcript (or specific files with `--files`)
2. Formats it as context for review
3. Sends it to a configured backend model (opencode, codex, gemini, openrouter, or custom)
4. Writes the review to `.claude/reviews/latest.md`
5. Presents findings in the transcript

#### Prerequisites

- Python 3.8+
- At least one backend CLI installed:

| Backend | Command | Install |
|---------|---------|---------|
| OpenCode | `opencode` | [github.com/opencode-ai/opencode](https://github.com/opencode-ai/opencode) |
| Codex | `codex` | [github.com/openai/codex](https://github.com/openai/codex) |
| Gemini CLI | `gemini` | [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| OpenRouter | `openrouter-backend.py` | Included (set `OPENROUTER_API_KEY`) |
| Custom | any CLI | Configure in config |

#### Configuration

Edit `.claude/second-opinion.config.json`:

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable the plugin |
| `auto_review_on_stop` | `false` | Auto-review on every Stop event (requires Stop hook registration) |
| `backend` | `"opencode"` | Which backend to use |
| `max_context_messages` | `20` | Max transcript messages to include |
| `max_context_chars` | `30000` | Max characters of context |
| `timeout` | `300` | Backend timeout in seconds |
| `cooldown` | `30` | Min seconds between reviews |
| `min_assistant_length` | `200` | Skip review if assistant response is shorter |
| `skip_patterns` | `[...]` | Regex patterns to skip (matched against user message) |
| `review_language` | `"en"` | Language for the review output |

Each backend in `backends` has:
- `command` — CLI executable name
- `args_template` — Arguments list; `{prompt}` is replaced with the review prompt
- `env` — Extra environment variables

#### Usage

**In Claude Code:** Use the `/second-opinion` slash command. You can also tell Claude:
> Read .claude/reviews/latest.md and address the issues found.

**CLI — review transcript:**
```bash
python3 .claude/hooks/second-opinion.py --transcript /path/to/transcript.jsonl --cwd . --force
```

**CLI — review specific files:**
```bash
python3 .claude/hooks/second-opinion.py --files src/main.py lib/ --cwd . --force
```

#### CLI Flags

| Flag | Description |
|------|-------------|
| `--transcript PATH` | Path to JSONL transcript file |
| `--cwd PATH` | Working directory override |
| `--force` | Bypass cooldown and length checks |
| `--backend NAME` | Override configured backend |
| `--files PATH [PATH ...]` | Review specific files/directories instead of transcript |
| `--prep-only` | Extract context and save prompt, then exit (for teammate mode) |
| `--dispatch FILE` | Read prompt from file, call backend, save review |

#### Security Notes

- The transcript context is sent to the configured backend CLI, which forwards it to its respective AI service
- Review files are written locally and excluded from git by default
- No network calls are made directly — all communication goes through the backend CLI
- The hook always exits with code 0 to never block Claude Code

#### Troubleshooting

**Hook doesn't run:**
- Verify `.claude/settings.local.json` has the Stop hook registered
- Check `enabled` is `true` in config
- Check cooldown hasn't been hit (delete `.claude/reviews/.last_run` to reset)

**Backend not found:**
- Ensure the CLI is installed and on your PATH
- Run `which opencode` (or your backend) to verify

**Empty reviews:**
- Transcript may be too short — check `min_assistant_length`
- Try `--force` flag to bypass skip checks

**Review quality:**
- Increase `max_context_messages` and `max_context_chars` for more context
- Try a different backend for different perspectives

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

### Option C: Standalone install (second opinion + commands)

```bash
bash /path/to/claude-code-helper/install.sh           # user-level (default, recommended)
bash /path/to/claude-code-helper/install.sh --project . # project-level
```

This installs the second-opinion hook, `/second-opinion` and `/backups` commands, and config. User-level install goes to `~/.claude/` and applies to all projects. Project-level goes to `.claude/` in the target directory.

To uninstall:
```bash
bash /path/to/claude-code-helper/install.sh --uninstall            # user-level
bash /path/to/claude-code-helper/install.sh --uninstall --project . # project-level
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

## License

MIT
