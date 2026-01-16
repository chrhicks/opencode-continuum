-- Tasks
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  intent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_status ON tasks(status);

-- Task Relationships
CREATE TABLE task_relationships (
  id TEXT PRIMARY KEY,
  from_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(from_task_id, to_task_id, type)
);

CREATE INDEX idx_relationships_from ON task_relationships(from_task_id);
CREATE INDEX idx_relationships_to ON task_relationships(to_task_id);
CREATE INDEX idx_relationships_type ON task_relationships(type);

-- Context Entries
CREATE TABLE context_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  superseded_by TEXT REFERENCES context_entries(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_context_task ON context_entries(task_id);
CREATE INDEX idx_context_type ON context_entries(type);

-- Progress Items
CREATE TABLE progress_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_progress_task ON progress_items(task_id);
CREATE INDEX idx_progress_completed ON progress_items(completed);

-- Session Links
CREATE TABLE session_links (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, session_id)
);

CREATE INDEX idx_session_links_task ON session_links(task_id);
CREATE INDEX idx_session_links_session ON session_links(session_id);

-- File Associations
CREATE TABLE file_associations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  operation TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_file_assoc_task ON file_associations(task_id);
CREATE INDEX idx_file_assoc_path ON file_associations(file_path);

-- Event Log (append-only)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  session_id TEXT
);

CREATE INDEX idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_type ON events(event_type);

-- Active Work Tracking (for automatic file association)
CREATE TABLE active_work (
  session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL
);
