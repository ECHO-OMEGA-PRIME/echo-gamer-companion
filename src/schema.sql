-- Echo Gamer Companion — GGI Apex Predator Cloud Backend
-- D1 Schema

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL,
  email TEXT,
  steam_id TEXT,
  discord_id TEXT,
  avatar_url TEXT,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  rank TEXT DEFAULT 'Bronze',
  total_sessions INTEGER DEFAULT 0,
  total_hours REAL DEFAULT 0,
  total_kills INTEGER DEFAULT 0,
  total_deaths INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  favorite_game TEXT,
  favorite_mode TEXT,
  settings JSON DEFAULT '{}',
  achievements JSON DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_username ON players(tenant_id, username);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  genre TEXT NOT NULL,
  icon TEXT DEFAULT '',
  supported_modes JSON DEFAULT '["observe","assist","coach"]',
  default_settings JSON DEFAULT '{}',
  detection_process TEXT,
  detection_steam_id TEXT,
  total_sessions INTEGER DEFAULT 0,
  total_players INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  skill_level TEXT DEFAULT 'intermediate',
  aggression REAL DEFAULT 0.5,
  reaction_time_ms INTEGER DEFAULT 200,
  dpi INTEGER DEFAULT 800,
  sensitivity REAL DEFAULT 1.0,
  preferred_mode TEXT DEFAULT 'assist',
  session_limit_hours REAL DEFAULT 4,
  keybinds JSON DEFAULT '{}',
  stats JSON DEFAULT '{}',
  total_sessions INTEGER DEFAULT 0,
  total_hours REAL DEFAULT 0,
  best_score REAL DEFAULT 0,
  avg_score REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(player_id, game_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  duration_min REAL DEFAULT 0,
  kills INTEGER DEFAULT 0,
  deaths INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  result TEXT,
  map_name TEXT,
  ai_actions INTEGER DEFAULT 0,
  ai_suggestions INTEGER DEFAULT 0,
  ai_accuracy REAL DEFAULT 0,
  mistakes JSON DEFAULT '[]',
  highlights JSON DEFAULT '[]',
  metadata JSON DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id, game_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(created_at);

CREATE TABLE IF NOT EXISTS training_drills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  difficulty TEXT DEFAULT 'medium',
  description TEXT,
  config JSON DEFAULT '{}',
  max_score REAL DEFAULT 100,
  total_attempts INTEGER DEFAULT 0,
  avg_score REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drill_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  drill_id INTEGER NOT NULL,
  score REAL NOT NULL,
  accuracy REAL DEFAULT 0,
  time_ms INTEGER DEFAULT 0,
  details JSON DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drill_attempts_player ON drill_attempts(player_id, drill_id);

CREATE TABLE IF NOT EXISTS pro_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  game_slug TEXT NOT NULL,
  team TEXT,
  region TEXT,
  role TEXT,
  playstyle TEXT,
  settings JSON DEFAULT '{}',
  patterns JSON DEFAULT '{}',
  stats JSON DEFAULT '{}',
  source_url TEXT,
  total_mimics INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  tag TEXT,
  game_slug TEXT,
  captain_id INTEGER,
  invite_code TEXT UNIQUE,
  max_members INTEGER DEFAULT 10,
  total_members INTEGER DEFAULT 0,
  total_scrims INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  settings JSON DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at TEXT DEFAULT (datetime('now')),
  UNIQUE(team_id, player_id)
);

CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER,
  game_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  map_name TEXT,
  type TEXT DEFAULT 'offensive',
  description TEXT,
  steps JSON DEFAULT '[]',
  positions JSON DEFAULT '[]',
  utility JSON DEFAULT '[]',
  callouts JSON DEFAULT '[]',
  win_rate REAL DEFAULT 0,
  times_used INTEGER DEFAULT 0,
  ai_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leaderboard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_slug TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  season TEXT NOT NULL,
  score REAL DEFAULT 0,
  rank INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  kd_ratio REAL DEFAULT 0,
  avg_score REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(game_slug, player_id, season)
);

CREATE TABLE IF NOT EXISTS analytics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  total_sessions INTEGER DEFAULT 0,
  total_players INTEGER DEFAULT 0,
  total_hours REAL DEFAULT 0,
  total_drills INTEGER DEFAULT 0,
  popular_game TEXT,
  popular_mode TEXT,
  avg_session_min REAL DEFAULT 0,
  UNIQUE(date)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
