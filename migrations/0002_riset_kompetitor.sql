-- Riset Kompetitor versi galeri: label iklan, angle, hook, daftar pantauan.

ALTER TABLE competitor_ads ADD COLUMN headline TEXT NOT NULL DEFAULT '';
ALTER TABLE competitor_ads ADD COLUMN landing TEXT NOT NULL DEFAULT '';
ALTER TABLE competitor_ads ADD COLUMN media_type TEXT NOT NULL DEFAULT '';      -- video | image | ''
ALTER TABLE competitor_ads ADD COLUMN video_seconds INTEGER;
ALTER TABLE competitor_ads ADD COLUMN active INTEGER NOT NULL DEFAULT 1;       -- masih tayang
ALTER TABLE competitor_ads ADD COLUMN angle TEXT NOT NULL DEFAULT '';          -- Edukasi, Promo / harga, ...
ALTER TABLE competitor_ads ADD COLUMN hook TEXT NOT NULL DEFAULT '';           -- Sangat kuat | Kuat | Biasa | Lemah
ALTER TABLE competitor_ads ADD COLUMN is_promo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitor_ads ADD COLUMN risky_claim INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitor_ads ADD COLUMN worth_copy INTEGER NOT NULL DEFAULT 0;

ALTER TABLE competitor_scans ADD COLUMN new_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitor_scans ADD COLUMN source TEXT NOT NULL DEFAULT 'bookmarklet';

CREATE TABLE IF NOT EXISTS competitor_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'keyword',                                       -- keyword | page
  value TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ID',
  created_at INTEGER NOT NULL,
  UNIQUE (kind, value, country)
);

CREATE INDEX IF NOT EXISTS idx_ads_page ON competitor_ads(page_name);
