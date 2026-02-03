CREATE TABLE IF NOT EXISTS match_threads (
    thread_id VARCHAR(32) PRIMARY KEY,
    match_id INT NOT NULL,
    match_type VARCHAR(20) NOT NULL, -- 'ladder' or 'tournament'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_match_lookup (match_id, match_type)
);
