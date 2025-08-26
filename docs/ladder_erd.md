# Ladder Multi-Ladder Support ERD

```mermaid
erDiagram
  ladders {
    BIGINT id PK
    VARCHAR name
    VARCHAR slug UNIQUE
    ENUM status
    DATETIME starts_at
    DATETIME ends_at
    VARCHAR timezone
    TINYINT allowed_days_mask
    TIME allowed_start_time
    TIME allowed_end_time
    INT max_matches_per_day
    JSON config
    DATETIME created_at
    DATETIME updated_at
  }
  ladder_matches {
    INT id PK
    BIGINT ladder_id FK
    INT player1_id FK
    INT player2_id FK
    INT player1_score
    INT player2_score
    ENUM status
    INT reported_by FK
    VARCHAR screenshot_url
    TIMESTAMP match_date
    INT competition_id FK
  }
  ladder_player_stats {
    INT player_id PK
    BIGINT ladder_id PK
    INT elo_rating
    INT games_played
    INT wins
    INT draws
    INT losses
    INT goals_scored
    INT goals_conceded
    INT points
    TIMESTAMP last_played
    INT goal_diff
    INT win_streak
    INT competition_id FK
  }
  ladder_elo_history {
    INT id PK
    INT match_id FK
    INT player_id FK
    INT old_elo
    INT new_elo
    INT delta
    TIMESTAMP changed_at
    INT competition_id FK
    BIGINT ladder_id FK
  }
  ladder_match_queue {
    INT id PK
    INT player_id FK
    VARCHAR discord_id
    TIMESTAMP looking_since
    INT competition_id FK
    BIGINT ladder_id FK
  }
  ladders ||--o{ ladder_matches : "id = ladder_id"
  ladders ||--o{ ladder_player_stats : "id = ladder_id"
  ladders ||--o{ ladder_elo_history : "id = ladder_id"
  ladders ||--o{ ladder_match_queue : "id = ladder_id"
