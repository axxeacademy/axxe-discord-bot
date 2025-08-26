-- Migration to add a table for mapping Discord channel IDs to ladder IDs
CREATE TABLE IF NOT EXISTS discord_channel_ladders (
  channel_id VARCHAR(64) NOT NULL PRIMARY KEY,
  ladder_id BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ladder FOREIGN KEY (ladder_id) REFERENCES ladders(id) ON DELETE CASCADE
);
