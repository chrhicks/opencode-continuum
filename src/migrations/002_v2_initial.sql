-- Tasks (v2)
CREATE TABLE tasks_v2 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  intent TEXT,
  description TEXT,
  plan TEXT,
  parent_id TEXT REFERENCES tasks_v2(id) ON DELETE SET NULL,
  blocked_by TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_v2_status ON tasks_v2(status);
CREATE INDEX idx_tasks_v2_parent ON tasks_v2(parent_id);
