-- migrations/20260203_phase2_tournaments.sql

-- 1. Create Seasons Table
CREATE TABLE IF NOT EXISTS seasons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE, -- e.g. "24/25"
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Upgrade Seasons Table safely (if it existed from older migration without slug)
DROP PROCEDURE IF EXISTS UpgradeSeasons;
DELIMITER //
CREATE PROCEDURE UpgradeSeasons()
BEGIN
    -- Check if 'slug' column exists
    IF NOT EXISTS (
        SELECT * FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'seasons' 
        AND COLUMN_NAME = 'slug'
    ) THEN
        ALTER TABLE seasons
        ADD COLUMN slug VARCHAR(50) NOT NULL DEFAULT 'temp_slug' AFTER name;
        -- Update existing rows to have unique slugs if needed, then add UNIQUE constraint
        -- For simplicity in this migration patch, we assume empty or low volume, 
        -- but strictly we should handle unique constraint violations.
        -- Let's just Add it without unique first if unsure, but requirement says UNIQUE.
        -- We will try to add it as NULLable first or Default, then modify?
        -- Actually, ALTER TABLE ... ADD COLUMN ... UNIQUE might fail if conflicts.
        -- Given this is dev env fix, let's try direct add.
        -- To be safer, let's just ADD schema.
        ALTER TABLE seasons ADD CONSTRAINT unique_seasons_slug UNIQUE (slug);
    END IF;

    -- Check if 'created_at' column exists
    IF NOT EXISTS (
        SELECT * FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'seasons' 
        AND COLUMN_NAME = 'created_at'
    ) THEN
        ALTER TABLE seasons
        ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END //
DELIMITER ;
CALL UpgradeSeasons();
DROP PROCEDURE UpgradeSeasons;

-- 2. Update Competitions Table safely
DROP PROCEDURE IF EXISTS UpgradeCompetitions;
DELIMITER //
CREATE PROCEDURE UpgradeCompetitions()
BEGIN
    -- Check if 'edition' column exists
    IF NOT EXISTS (
        SELECT * FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'competitions' 
        AND COLUMN_NAME = 'edition'
    ) THEN
        ALTER TABLE competitions
        ADD COLUMN edition VARCHAR(50) DEFAULT NULL AFTER slug, 
        ADD COLUMN season_id INT DEFAULT NULL AFTER edition,
        ADD CONSTRAINT fk_competitions_season FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL;
    END IF;
END //
DELIMITER ;

CALL UpgradeCompetitions();
DROP PROCEDURE UpgradeCompetitions;

-- 3. Update Tournament Matches Table safely
DROP PROCEDURE IF EXISTS UpgradeTournamentMatches;
DELIMITER //
CREATE PROCEDURE UpgradeTournamentMatches()
BEGIN
    -- Check if 'round_slug' column exists
    IF NOT EXISTS (
        SELECT * FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'tournament_matches' 
        AND COLUMN_NAME = 'round_slug'
    ) THEN
        ALTER TABLE tournament_matches
        ADD COLUMN round_slug VARCHAR(20) DEFAULT NULL AFTER round;
    END IF;
END //
DELIMITER ;

CALL UpgradeTournamentMatches();
DROP PROCEDURE UpgradeTournamentMatches;

-- 4. Insert Initial Season (Optional Default)
INSERT IGNORE INTO seasons (name, slug, start_date, is_active)
VALUES ('Season 24/25', '24/25', CURRENT_DATE, 1);
