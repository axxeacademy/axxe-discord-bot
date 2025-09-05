-- Migration: Create ladder_queue_history table to track user queue times

CREATE TABLE ladder_queue_history (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  discord_id VARCHAR(50) NOT NULL,
  competition_id INT NOT NULL,
  ladder_id BIGINT NOT NULL,
  queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL DEFAULT NULL,
  left_reason ENUM('matched', 'cancelled', 'purged') DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (competition_id) REFERENCES seasons(id),
  FOREIGN KEY (ladder_id) REFERENCES ladders(id),
  INDEX idx_lqh_user_id (user_id),
  INDEX idx_lqh_ladder_id (ladder_id),
  INDEX idx_lqh_competition_id (competition_id)
);
