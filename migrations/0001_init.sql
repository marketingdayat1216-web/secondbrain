-- Skema awal Second Brain. Semua waktu disimpan sebagai epoch milidetik (UTC).

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',          -- todo | done
  priority TEXT NOT NULL DEFAULT 'normal',      -- low | normal | high
  due_at INTEGER,
  remind_at INTEGER,
  reminded INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'web',
  created_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(status, reminded, remind_at);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'web',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'lainnya',
  source TEXT NOT NULL DEFAULT 'chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,                         -- telegram | web
  role TEXT NOT NULL,                            -- user | assistant
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',           -- idle | thinking | meeting | working | delivering
  activity TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  run_id INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',         -- queued | planning | running | done | failed
  plan TEXT NOT NULL DEFAULT '[]',
  results TEXT NOT NULL DEFAULT '[]',
  report TEXT NOT NULL DEFAULT '',
  note_id INTEGER,
  source TEXT NOT NULL DEFAULT 'web',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,                            -- plan | start | result | report | error | info
  content TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, id);

CREATE TABLE IF NOT EXISTS competitor_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  ad_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS competitor_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id TEXT NOT NULL UNIQUE,
  page_name TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  start_ts INTEGER,
  variants INTEGER NOT NULL DEFAULT 1,
  rank INTEGER,
  keyword TEXT NOT NULL DEFAULT '',
  scan_id INTEGER,
  media TEXT NOT NULL DEFAULT '[]',              -- [{type:'image'|'video', url, poster, saved}]
  media_saved INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  score_reason TEXT NOT NULL DEFAULT '',
  score_model TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '',
  analysis_status TEXT NOT NULL DEFAULT '',      -- '' | pending | done | error
  variations TEXT NOT NULL DEFAULT '',
  variations_status TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ads_keyword ON competitor_ads(keyword, rank);
CREATE INDEX IF NOT EXISTS idx_ads_scan ON competitor_ads(scan_id);
