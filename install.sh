#!/usr/bin/env bash
set -euo pipefail

# claude-code-helper — Installer
# Installs hooks, commands, and config to user (~/.claude) or project level.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Usage ─────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
Usage: install.sh [OPTIONS] [TARGET_DIR]

Install claude-code-helper (hooks, commands, config).

Options:
  --project         Install to a project directory (default: user-level ~/.claude)
  --uninstall       Remove all installed components
  -h, --help        Show this help

Target:
  If --project is given, TARGET_DIR defaults to current directory.
  Otherwise, installs to ~/.claude (user-level, applies to all projects).

Examples:
  bash install.sh                  # Install for user (recommended)
  bash install.sh --project .     # Install for current project only
  bash install.sh --uninstall     # Uninstall from user level
EOF
    exit 0
}

# ─── Parse flags ───────────────────────────────────────────────────────
UNINSTALL=false
PROJECT_MODE=false
POSITIONAL=()
for arg in "$@"; do
    case "$arg" in
        --uninstall) UNINSTALL=true ;;
        --project)   PROJECT_MODE=true ;;
        -h|--help)   usage ;;
        *)           POSITIONAL+=("$arg") ;;
    esac
done

if $PROJECT_MODE; then
    TARGET_DIR="${POSITIONAL[0]:-.}"
    TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
    CLAUDE_DIR="$TARGET_DIR/.claude"
    LABEL="project ($TARGET_DIR)"
else
    CLAUDE_DIR="$HOME/.claude"
    LABEL="user (~/.claude)"
    TARGET_DIR="$HOME"
fi

# ─── Uninstall ─────────────────────────────────────────────────────────
if $UNINSTALL; then
    echo "claude-code-helper — Uninstaller"
    echo "================================"
    echo "Target:  $LABEL"
    echo ""

    for f in hooks/second-opinion.py hooks/openrouter-backend.py \
             commands/second-opinion.md commands/backups.md \
             second-opinion.config.json; do
        if [ -f "$CLAUDE_DIR/$f" ]; then
            rm "$CLAUDE_DIR/$f"
            echo "✓ Removed $f"
        fi
    done

    if [ -d "$CLAUDE_DIR/reviews" ]; then
        rm -rf "$CLAUDE_DIR/reviews"
        echo "✓ Removed reviews directory"
    fi

    # Clean up .gitignore (project mode only)
    if $PROJECT_MODE; then
        GITIGNORE="$TARGET_DIR/.gitignore"
        if [ -f "$GITIGNORE" ] && grep -q ".claude/reviews/" "$GITIGNORE" 2>/dev/null; then
            python3 -c "
lines = open('$GITIGNORE').readlines()
out = [l for l in lines if '# Second Opinion reviews' not in l and '.claude/reviews/' not in l]
while out and out[-1].strip() == '':
    out.pop()
if out:
    with open('$GITIGNORE', 'w') as f:
        f.writelines(out)
        if not out[-1].endswith('\n'):
            f.write('\n')
" 2>/dev/null && echo "✓ Cleaned .gitignore" || true
        fi
    fi

    rmdir "$CLAUDE_DIR/hooks" 2>/dev/null && echo "✓ Removed empty hooks directory" || true
    rmdir "$CLAUDE_DIR/commands" 2>/dev/null && echo "✓ Removed empty commands directory" || true

    echo ""
    echo "─── Uninstall complete ───"
    exit 0
fi

# ─── Install ───────────────────────────────────────────────────────────
echo "claude-code-helper — Installer"
echo "=============================="
echo "Source:  $SCRIPT_DIR"
echo "Target:  $LABEL"
echo ""

# Create directories
mkdir -p "$CLAUDE_DIR/hooks"
mkdir -p "$CLAUDE_DIR/commands"

# ─── Second Opinion scripts ───────────────────────────────────────────
cp "$SCRIPT_DIR/.claude/hooks/second-opinion.py" "$CLAUDE_DIR/hooks/second-opinion.py"
chmod +x "$CLAUDE_DIR/hooks/second-opinion.py"
echo "✓ Installed second-opinion.py"

cp "$SCRIPT_DIR/.claude/hooks/openrouter-backend.py" "$CLAUDE_DIR/hooks/openrouter-backend.py"
chmod +x "$CLAUDE_DIR/hooks/openrouter-backend.py"
echo "✓ Installed openrouter-backend.py"

# ─── Slash commands ────────────────────────────────────────────────────
cp "$SCRIPT_DIR/.claude/commands/second-opinion.md" "$CLAUDE_DIR/commands/second-opinion.md"
echo "✓ Installed /second-opinion command"

cp "$SCRIPT_DIR/.claude/commands/backups.md" "$CLAUDE_DIR/commands/backups.md"
echo "✓ Installed /backups command"

# ─── Config (don't overwrite existing) ─────────────────────────────────
if [ ! -f "$CLAUDE_DIR/second-opinion.config.json" ]; then
    cp "$SCRIPT_DIR/.claude/second-opinion.config.json" "$CLAUDE_DIR/second-opinion.config.json"
    echo "✓ Installed default config (auto_review_on_stop: false)"
else
    echo "• Config already exists, skipping"
fi

# ─── .gitignore (project mode only) ───────────────────────────────────
if $PROJECT_MODE; then
    GITIGNORE="$TARGET_DIR/.gitignore"
    if [ -f "$GITIGNORE" ]; then
        if ! grep -q ".claude/reviews/" "$GITIGNORE" 2>/dev/null; then
            echo "" >> "$GITIGNORE"
            echo "# Second Opinion reviews" >> "$GITIGNORE"
            echo ".claude/reviews/" >> "$GITIGNORE"
            echo "✓ Updated .gitignore"
        fi
    else
        echo ".claude/reviews/" > "$GITIGNORE"
        echo "✓ Created .gitignore"
    fi
fi

# ─── Backend availability ─────────────────────────────────────────────
echo ""
echo "─── Backend Availability ───"
echo ""
for cmd in opencode codex gemini; do
    if command -v "$cmd" &>/dev/null; then
        echo "✓ $cmd — $(command -v "$cmd")"
    else
        echo "✗ $cmd — not found"
    fi
done

echo ""
echo "─── Done ───"
echo ""
echo "Installed to: $LABEL"
echo ""
echo "What's included:"
echo "  • /second-opinion — trigger a code review (manual only)"
echo "  • /backups — view context recovery backups"
echo "  • Configure backend in second-opinion.config.json"
echo ""
echo "For dangerous command blocking + context recovery backup, install the plugin:"
echo "  claude --plugin-dir $SCRIPT_DIR"
