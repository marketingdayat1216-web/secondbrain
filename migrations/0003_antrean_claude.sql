-- Antrean pekerjaan untuk Claude (langganan) yang dikerjakan lewat konektor MCP,
-- dipakai saat tidak ada ANTHROPIC_API_KEY.
CREATE TABLE IF NOT EXISTS claude_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                       -- write (penulisan konten)
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | done
  result TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  done_at INTEGER
);

-- Permintaan yang tadi gagal karena belum ada API key dipindah ke antrean Claude.
UPDATE competitor_ads SET analysis_status = 'claude', analysis = ''
  WHERE analysis_status = 'error' AND analysis LIKE '%ANTHROPIC_API_KEY%';
UPDATE competitor_ads SET variations_status = 'claude', variations = ''
  WHERE variations_status = 'error' AND variations LIKE '%ANTHROPIC_API_KEY%';
