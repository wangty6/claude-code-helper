Recover context from backups after compaction.

## Steps

1. Find the current session ID from the environment or hook input. The session ID is available as `$CLAUDE_SESSION_ID` if set, or from the most recent state file at `~/.claude/claudefast-statusline-state.json` (key: `sessionId`).

2. List all `.md` files in `~/.claude/backups/`, sorted by modification time (newest first).

3. For each file, read the first 500 bytes and check if it contains the current session ID. Collect only the matching files.

4. If no backups match the current session, say: "No backups found for this session."

5. If backups are found, read the most recent backup file. Then present the recovered context to the user in this order:

   **First — show the user's prompts/requests prominently:**
   ```
   ## Recovered User Requests
   These are the prompts you gave before compaction:
   1. <request 1>
   2. <request 2>
   ...
   ```

   **Then — show the working context:**
   ```
   ## Working Context
   - **Modified files:** <list>
   - **Tasks:** <list>
   - **Skills loaded:** <list>
   - **Sub-agents:** <list>
   - **Build/test commands:** <list>
   ```

   **Finally — show metadata:**
   ```
   ## Backup Info
   - Trigger: <trigger>
   - Context remaining at backup: <pct>
   - Timestamp: <time>
   - Backup file: <path>
   ```

6. If there are multiple backups for this session, mention: "N total backup(s) found. Showing the most recent. Ask to see older ones if needed."
