-- migrations/20260207_competition_channel.sql

ALTER TABLE competitions ADD COLUMN discord_channel_id VARCHAR(64) DEFAULT NULL AFTER settings;
