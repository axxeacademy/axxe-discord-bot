---
name: battlefy-replicator
description: Replicates a Battlefy tournament bracket in Discord for verification purposes. Takes bracket info and channel ID, stores a script in the DB, and provides a generic Discord command to execute it.
---

# Battlefy Replicator

## Workflow

1.  **Prepare Data**: Create a JSON file with the participants list in seed order.
2.  **Generate Script**: Run `node SKILLS/battlefy-replicator/scripts/create_db_script.js <json_path> <channel_id>`.
3.  **Execute in Discord**: Run `/tournament script <ID>` in the bot.

## Input Format

The JSON file should be a flat array of strings, representing participants in match order.
Example for 4 players (2 matches):
```json
[
  "Player A", "Player B",
  "Player C", "Player D"
]
```
If there is a BYE, use `null` or `"BYE"`.

## Database

This skill uses a temporary table `tournament_scripts` (created automatically if missing):
- `id` (INT, PK, AI)
- `participants` (JSON)
- `channel_id` (VARCHAR)
- `created_at` (TIMESTAMP)

## Discord Command

The `/tournament script <ID>` command:
1.  Fetches the script.
2.  Creates a competition.
3.  Registers participants in order.
4.  Starts the competition (generating threads).
