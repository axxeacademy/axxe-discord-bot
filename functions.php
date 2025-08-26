<?php
require_once __DIR__ . '/../config.php';

function getTopPlayers() {
  $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
  $players = [];

  if (!$conn->connect_error) {
    $sql = "
      SELECT p.username, p.avatar_url, p.platform, ps.points, ps.games_played, ps.wins, ps.goal_diff
      FROM player_stats ps
      JOIN players p ON ps.player_id = p.id
      ORDER BY ps.points DESC, ps.goal_diff DESC
      LIMIT 5
    ";
    $result = $conn->query($sql);
    if ($result && $result->num_rows > 0) {
      while ($row = $result->fetch_assoc()) {
        $row['win_rate'] = ($row['games_played'] > 0) ? round(($row['wins'] / $row['games_played']) * 100) : 0;
        $players[] = $row;
      }
    }
    $conn->close();
  }

  return $players;
}


function getAllPlayersPaginated($limit, $offset, $filters = []) {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $players = [];
  
    if ($conn->connect_error) return [];
  
    $sql = "
      SELECT p.username, p.avatar_url, p.platform, p.discord_id, ps.points, ps.games_played, ps.wins, ps.goal_diff
      FROM player_stats ps
      JOIN players p ON ps.player_id = p.id
      WHERE 1 = 1
    ";
  
    $params = [];
    $types = '';
  
    if (!empty($filters['search'])) {
      $sql .= " AND p.username LIKE ?";
      $params[] = '%' . $filters['search'] . '%';
      $types .= 's';
    }
  
    if (!empty($filters['platform'])) {
      $sql .= " AND p.platform = ?";
      $params[] = $filters['platform'];
      $types .= 's';
    }
  
    if (!empty($filters['min_games']) || $filters['min_games'] === '0') {
        switch ($filters['min_games']) {
          case -10:
            $sql .= " AND ps.games_played < 10";
            break;
          case 10:
            $sql .= " AND ps.games_played >= 10 AND ps.games_played < 25";
            break;
          case 25:
            $sql .= " AND ps.games_played >= 25 AND ps.games_played < 50";
            break;
          case 50:
            $sql .= " AND ps.games_played >= 50";
            break;
        }
      }
  
    $sql .= " ORDER BY ps.points DESC, ps.goal_diff DESC LIMIT ?, ?";
    $params[] = $offset;
    $params[] = $limit;
    $types .= 'ii';
  
    $stmt = $conn->prepare($sql);
    if ($types) {
      $stmt->bind_param($types, ...$params);
    }
  
    $stmt->execute();
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) {
      $row['win_rate'] = ($row['games_played'] > 0) ? round(($row['wins'] / $row['games_played']) * 100) : 0;
      $players[] = $row;
    }
  
    $stmt->close();
    $conn->close();
  
    return $players;
  }
  
  function getTotalPlayerCount($filters = []) {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $total = 0;
  
    if ($conn->connect_error) return 0;
  
    $sql = "
      SELECT COUNT(*) as count
      FROM player_stats ps
      JOIN players p ON ps.player_id = p.id
      WHERE 1 = 1
    ";
  
    $params = [];
    $types = '';
  
    if (!empty($filters['search'])) {
      $sql .= " AND p.username LIKE ?";
      $params[] = '%' . $filters['search'] . '%';
      $types .= 's';
    }
  
    if (!empty($filters['platform'])) {
      $sql .= " AND p.platform = ?";
      $params[] = $filters['platform'];
      $types .= 's';
    }
  
    if (!empty($filters['min_games']) || $filters['min_games'] === '0') {
        switch ($filters['min_games']) {
          case -10:
            $sql .= " AND ps.games_played < 10";
            break;
          case 10:
            $sql .= " AND ps.games_played >= 10 AND ps.games_played < 25";
            break;
          case 25:
            $sql .= " AND ps.games_played >= 25 AND ps.games_played < 50";
            break;
          case 50:
            $sql .= " AND ps.games_played >= 50";
            break;
        }
      }
  
    $stmt = $conn->prepare($sql);
    if ($types) {
      $stmt->bind_param($types, ...$params);
    }
  
    $stmt->execute();
    $result = $stmt->get_result();
    if ($row = $result->fetch_assoc()) {
      $total = $row['count'];
    }
  
    $stmt->close();
    $conn->close();
  
    return $total;
  }
  
  function applyDailyDecay() {
  $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
  if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
  }

  $decayPerDay = 15;
  $minElo = 800;
  $today = new DateTime();

  $query = "SELECT player_id, elo_rating, last_played FROM player_stats";
  $result = $conn->query($query);

  if ($result && $result->num_rows > 0) {
    while ($row = $result->fetch_assoc()) {
      $playerId = $row['player_id'];
      $elo = (int)$row['elo_rating'];
      $lastPlayed = $row['last_played'];

      if (!$lastPlayed) continue;

      $lastPlayedDate = new DateTime($lastPlayed);
      $daysInactive = $lastPlayedDate->diff($today)->days;

      if ($daysInactive > 5) {
        $decayDays = $daysInactive - 5;
        $decayAmount = $decayDays * $decayPerDay;
        $newElo = max($elo - $decayAmount, $minElo);
        $delta = $newElo - $elo;

        // Update elo_rating
        $update = $conn->prepare("UPDATE player_stats SET elo_rating = ? WHERE player_id = ?");
        $update->bind_param("ii", $newElo, $playerId);
        $update->execute();
        $update->close();

        // Insert into elo_history with match_id = NULL
        $insert = $conn->prepare("
          INSERT INTO elo_history (player_id, match_id, old_elo, new_elo, delta, changed_at)
          VALUES (?, NULL, ?, ?, ?, NOW())
        ");
        $insert->bind_param("iiii", $playerId, $elo, $newElo, $delta);
        $insert->execute();
        $insert->close();
      }
    }
  }

  $conn->close();
}
  
