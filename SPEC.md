# Arbeit - Agent Task Management System

## 1. Overview

Arbeit is a task management system designed **for AI agents** as the primary consumer. It provides structured persistence for long-horizon work: managing complex features, multi-session projects, and tasks that span days or weeks.

### Design Philosophy

- **Agent-first**: The data model and API are optimized for agent consumption, not human UIs. Human interfaces are a secondary concern and can be built later.
- **Resumable context**: Tasks are not just to-do items—they are bundles of context that allow an agent to resume work across sessions.
- **Explicit over implicit**: No magic behavior. The agent explicitly signals intent (e.g., "I'm starting work on this task").
- **Audit trail**: All mutations are logged as events, providing full history for debugging, learning, and accountability.
- **Simple and extensible**: Start with core functionality; complexity is added only when proven necessary.

### Integration Model

Arbeit is implemented as an **OpenCode plugin** with custom tools. Agents interact with arbeit through tool calls (e.g., `arbeit_task_create`, `arbeit_task_get`). Data is stored in a local SQLite database within the project directory.

---

## 2. Concepts

### 2.1 Task

A task is the fundamental unit of work. Unlike traditional task managers, an arbeit task is a **resumable context unit**—it contains not just what needs to be done, but the accumulated knowledge, decisions, and history needed to continue work.

**Properties:**
- `id`: Unique identifier (e.g., `tkt-a7f3b2c1`)
- `title`: Brief description of the task
- `status`: Current state (`open`, `in_progress`, `completed`, `cancelled`)
- `intent`: The "why"—immutable after creation, captures the original goal
- `created_at`, `updated_at`: Timestamps

**Example:**
```
tkt-a7f3b2c1: "Implement session timeout handling"
Status: in_progress
Intent: "Users are complaining that sessions never expire, creating security risk.
         Need to implement 30-minute idle timeout with warning modal."
```

### 2.2 Context Entry

Context entries are the accumulated knowledge attached to a task. They capture decisions, attempts, blockers, and other information that helps an agent understand what has happened and why.

**Types:**
| Type | Purpose | Example |
|------|---------|---------|
| `decision` | A choice that was made | "Using localStorage over server-side sessions" |
| `rationale` | Why a decision was made | "Simpler, no backend changes needed" |
| `attempt` | Something that was tried | "Tried visibilitychange API" |
| `outcome` | Result of an attempt | "Failed - unreliable on mobile Safari" |
| `blocker` | Something preventing progress | "Need user input on timeout duration" |
| `note` | General observation | "Found related code in legacy/ but deprecated" |
| `reference` | Link to external resource | "See RFC 6749 for OAuth spec" |
| `user_input` | Direct input from the human | "User confirmed: 30 minute timeout" |

**Properties:**
- `id`: Unique identifier
- `task_id`: The task this entry belongs to
- `type`: One of the types above
- `content`: The actual content
- `metadata`: Optional JSON blob for type-specific data
- `superseded_by`: Reference to a newer entry that replaces this one (for marking stale context)
- `created_at`: Timestamp (entries are immutable)

### 2.3 Relationship

Tasks can be connected through typed relationships, forming a graph structure.

**Relationship Types:**
| Type | Meaning | Inverse |
|------|---------|---------|
| `parent_of` | Hierarchy (epic -> task -> subtask) | `child_of` |
| `blocks` | Dependency (A must complete before B) | `blocked_by` |
| `relates_to` | Soft reference (relevant context) | `relates_to` |
| `duplicates` | Same work | `duplicated_by` |
| `splits_from` | Task was broken up | `split_into` |

**Constraints:**
- Maximum hierarchy depth: 4 levels
- Circular dependencies are detected and rejected with an error
- Relationships can have optional metadata (e.g., reason for blocking)

### 2.4 Progress Item

Progress items track the specific work completed and remaining within a task.

**Properties:**
- `id`: Unique identifier
- `task_id`: The task this belongs to
- `content`: Description of the work item
- `completed`: Boolean (false = remaining, true = completed)
- `created_at`, `completed_at`: Timestamps

### 2.5 Session Link

Links between arbeit tasks and OpenCode sessions, enabling traceability of what work was done where.

**Properties:**
- `id`: Unique identifier
- `task_id`: The arbeit task
- `session_id`: The OpenCode session ID
- `created_at`: Timestamp

Session links are created implicitly when an agent starts work on a task (via `arbeit_task_start_work`).

### 2.6 File Association

Tracks which files were read or written while working on a task.

**Properties:**
- `id`: Unique identifier
- `task_id`: The task this file is associated with
- `file_path`: Relative path to the file
- `operation`: `read` or `write`
- `session_id`: The session in which this occurred
- `created_at`: Timestamp

File associations are captured automatically via plugin hooks when a task is being actively worked on.

### 2.7 Event

All mutations to arbeit data are logged as immutable events, providing a complete audit trail.

**Properties:**
- `id`: Unique identifier
- `timestamp`: When the event occurred
- `event_type`: What happened (e.g., `task_created`, `context_added`)
- `entity_type`: What was affected (`task`, `relationship`, `context_entry`, etc.)
- `entity_id`: The ID of the affected entity
- `payload`: Full JSON blob of the event data
- `session_id`: The OpenCode session that triggered this (if applicable)

---

## 3. Architecture

### 3.1 Storage

Arbeit uses **SQLite** as its storage backend, providing:
- Embedded operation (no server required)
- Efficient queries for graph relationships
- Single-file portability (`.arbeit/arbeit.db`)
- Full SQL power for complex queries

The database is stored at `.arbeit/arbeit.db` relative to the project root.

### 3.2 OpenCode Integration

Arbeit integrates with OpenCode through two mechanisms:

**Custom Tools** (`.opencode/tool/arbeit.ts`):
Expose arbeit functionality as tools the agent can call. Each tool has a well-defined schema and returns structured responses.

**Plugin** (`.opencode/plugin/arbeit.ts`):
Hooks into OpenCode events to provide automatic functionality:
- Captures file read/write events when a task is being actively worked on
- Links sessions to tasks automatically

### 3.3 Project Scope

Each project directory has its own arbeit database. Projects are fully isolated—there are no cross-project references. The "project" is implicitly defined by the directory containing `.arbeit/`.

### 3.4 Initialization

Arbeit must be explicitly initialized before use. The agent calls `arbeit_init()` to create the `.arbeit/` directory and database. This should be prompted via instructions in `AGENTS.md` or similar.

---

## 4. Database Schema

```sql
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
```

---

## 5. Tool API Reference

All tools return a structured response:

```typescript
type ArbeitResponse<T> = {
  success: boolean;
  data?: T;
  warnings?: string[];
  error?: {
    code: string;
    message: string;
    suggestions?: string[];
  };
}
```

### 5.1 Initialization

#### `arbeit_init`
Use before any other arbeit tools; creates the local .arbeit database.

**Parameters:** None

**Returns:** `{ initialized: boolean, path: string }`

**Errors:**
- `ALREADY_INITIALIZED`: `.arbeit/` already exists

---

### 5.2 Task Management

#### `arbeit_task_create`
Use to create a planning unit or subtask; optionally link it into a hierarchy.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | yes | Short task label for planning. |
| `intent` | string | no | Immutable goal or rationale to resume later. |
| `parent_id` | string | no | Optional parent task to build hierarchy. |
| `status` | string | no | Initial status; usually open. |

**Returns:** `{ task: Task }`

**Errors:**
- `PARENT_NOT_FOUND`: Specified parent task doesn't exist
- `MAX_DEPTH_EXCEEDED`: Would exceed 4-level hierarchy limit

---

#### `arbeit_task_get`
Use to fetch a task; request sections in include for briefing-level context.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID to fetch. |
| `include` | string[] | no | Optional sections for context/briefing; omit for core task only. |

**Include Options:**
- `relationships`
- `context`
- `context_all`
- `progress`
- `progress_summary`
- `parent`
- `children`
- `blocked_by`
- `blocking`
- `files`
- `sessions`
- `recent_events`

**Returns:** `{ task: Task, ... }` (requested sections only)

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist

---

#### `arbeit_task_update`
Use to rename a task or advance its status as work progresses.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID to update. |
| `title` | string | no | New title when scope changes. |
| `status` | string | no | Updated lifecycle state. |

**Returns:** `{ task: Task }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `INVALID_STATUS`: Status not one of: `open`, `in_progress`, `completed`, `cancelled`

**Warnings:**
- `HAS_INCOMPLETE_CHILDREN`: Completing a task with incomplete children

---

#### `arbeit_task_delete`
Use to remove a task that is no longer needed (must have no children).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID to delete (must have no children). |

**Returns:** `{ deleted: boolean }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `HAS_CHILDREN`: Task has child tasks (must delete or re-parent children first)

---

### 5.3 Work Session Management

#### `arbeit_task_start_work`
Use when actively working in this session; links the session and enables file tracking.
- Sets task status to `in_progress` (if currently `open`)
- Links the current OpenCode session to the task
- Enables automatic file tracking for this session

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID to actively work on. |

**Returns:** `{ task: Task, session_linked: boolean }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `ALREADY_WORKING`: This session is already working on a different task

---

#### `arbeit_task_stop_work`
Use when pausing or finishing work in this session; ends active tracking.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID to stop working on. |

**Returns:** `{ stopped: boolean, files_tracked: number }`

---

### 5.4 Context Management

#### `arbeit_context_add`
Use to record decisions, attempts, blockers, or notes; can supersede stale context.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task this context belongs to. |
| `type` | string | yes | Context label (decision, blocker, attempt, etc.). |
| `content` | string | yes | The context text to store. |
| `metadata` | object | no | Optional structured details (source, links, etc.). |
| `supersede_entry_id` | string | no | Set to replace a stale entry with this one. |

**Returns:** `{ entry: ContextEntry, superseded?: ContextEntry }` (when superseding, `entry.metadata` inherits prior metadata unless explicitly provided)

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `INVALID_TYPE`: Type not recognized
- `ENTRY_NOT_FOUND`: Entry doesn't exist
- `ALREADY_SUPERSEDED`: Entry was already superseded

---

### 5.5 Progress Management

#### `arbeit_progress_add`
Use to track concrete work steps for a task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task to attach work items to. |
| `items` | string[] | yes | List of concrete work steps. |
| `completed` | boolean | no | Mark items complete on creation. |

**Returns:** `{ items: ProgressItem[] }`

---

#### `arbeit_progress_complete`
Use to mark tracked work steps as done.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `item_ids` | string[] | yes | Progress item IDs to mark done. |

**Returns:** `{ completed: ProgressItem[] }`

---

### 5.6 Relationship Management

#### `arbeit_relationship`
Use to add or remove hierarchy/dependency links between tasks.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | string | yes | Whether to add or remove the relationship. |
| `from_task_id` | string | yes | Source task for the relationship. |
| `to_task_id` | string | yes | Target task for the relationship. |
| `type` | string | yes | Relationship type; inverse forms normalize automatically. |
| `metadata` | object | no | Optional reason/metadata (add only). |

**Returns:** `{ relationship: Relationship }` when `action=add`, `{ removed: boolean }` when `action=remove`

**Errors:**
- `TASK_NOT_FOUND`: One of the tasks doesn't exist
- `CIRCULAR_DEPENDENCY`: Would create a cycle (for `blocks` relationships)
- `RELATIONSHIP_EXISTS`: This relationship already exists
- `INVALID_TYPE`: Relationship type not recognized

---

### 5.7 Queries

#### `arbeit_query`
Use for list and graph queries (tasks, blockers, ancestry).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Named query to run. |
| `params` | object | no | Query filters (status, parent_id, task_id). |

**Available Queries:**

| Query Name | Parameters | Description |
|------------|------------|-------------|
| `tasks` | `status?`, `parent_id?` | List tasks (parent_id `null` = root tasks) |
| `blocked_tasks` | `status?` | Tasks that are blocked by other tasks |
| `blocking_tasks` | `status?` | Tasks that are blocking other tasks |
| `children_of` | `task_id` | Direct children of a task |
| `descendants_of` | `task_id` | All descendants (recursive) |
| `ancestors_of` | `task_id` | All ancestors (recursive) |
| `recent_activity` | `since`, `task_id?` | Recent context entries and progress |
| `stale_tasks` | `days` | Tasks not updated in N days |
| `files_for_task` | `task_id` | Files associated with a task |
| `tasks_for_file` | `file_path` | Tasks that touched a file |

**Returns:** Query-specific results

Note: `root_tasks` can be expressed as `query: "tasks"` with `parent_id: null`.

---

#### `arbeit_task_get` (briefing-style)
Use `include` to request a full briefing-style payload. For example:

```typescript
arbeit_task_get({
  task_id: "tkt-abc002",
  include: [
    "parent",
    "children",
    "blocked_by",
    "blocking",
    "context_all",
    "progress_summary",
    "files",
    "sessions",
    "recent_events"
  ]
})
```

---

### 5.8 Migration Notes

- `arbeit_context_supersede` -> `arbeit_context_add` with `supersede_entry_id`
- `arbeit_briefing` -> `arbeit_task_get` with `include` (see briefing-style example)
- `arbeit_relationship_add` / `arbeit_relationship_remove` -> `arbeit_relationship` with `action`
- `arbeit_task_list` -> `arbeit_query` with `query: "tasks"`

---

## 6. Event Types

All mutations are logged with the following event types:

| Event Type | Entity Type | Description |
|------------|-------------|-------------|
| `task_created` | task | New task created |
| `task_updated` | task | Task properties changed |
| `task_deleted` | task | Task deleted |
| `context_added` | context_entry | Context entry added |
| `context_superseded` | context_entry | Context entry marked superseded |
| `progress_added` | progress_item | Progress items added |
| `progress_completed` | progress_item | Progress items completed |
| `relationship_added` | relationship | Relationship created |
| `relationship_removed` | relationship | Relationship removed |
| `work_started` | session_link | Agent started work on task |
| `work_stopped` | session_link | Agent stopped work on task |
| `file_tracked` | file_association | File read/write associated with task |

---

## 7. Error Handling

### Error Codes

| Code | Description | Suggestions |
|------|-------------|-------------|
| `NOT_INITIALIZED` | arbeit not initialized in this directory | Call `arbeit_init()` first |
| `TASK_NOT_FOUND` | Task ID doesn't exist | Check task ID, use `arbeit_query()` with `tasks` |
| `ENTRY_NOT_FOUND` | Context entry doesn't exist | Check entry ID |
| `PARENT_NOT_FOUND` | Parent task doesn't exist | Check parent ID, create parent first |
| `MAX_DEPTH_EXCEEDED` | Would exceed 4-level hierarchy | Restructure task hierarchy |
| `CIRCULAR_DEPENDENCY` | Would create dependency cycle | Review dependency graph |
| `RELATIONSHIP_EXISTS` | Relationship already exists | No action needed, or remove first |
| `HAS_CHILDREN` | Cannot delete task with children | Delete or re-parent children first |
| `ALREADY_WORKING` | Session already working on another task | Call `arbeit_task_stop_work()` first |
| `ALREADY_SUPERSEDED` | Entry already superseded | Reference the superseding entry |
| `INVALID_STATUS` | Status value not recognized | Use: open, in_progress, completed, cancelled |
| `INVALID_TYPE` | Type value not recognized | Check documentation for valid types |

### Warnings

Warnings are non-fatal issues that the agent should be aware of:

| Warning | Description |
|---------|-------------|
| `HAS_INCOMPLETE_CHILDREN` | Completing a task that has incomplete children |
| `HAS_BLOCKERS` | Starting work on a task that has unresolved blockers |
| `STALE_CONTEXT` | Task has context entries older than 7 days without updates |
| `ORPHAN_RELATIONSHIPS` | Relationship references deleted task (cleanup needed) |

---

## 8. Future Considerations

The following features are explicitly deferred for future versions:

### v2 Candidates
- **Auto-capture on session end**: Extract accomplishments from session and update task progress automatically
- **Agentic suggestions**: `arbeit_suggest_next_task()` that analyzes the graph and recommends what to work on
- **Cross-project references**: Link tasks across different project directories
- **Human UI layer**: Dashboard, web interface, or CLI for human interaction
- **Task templates**: Predefined task structures for common patterns
- **Time tracking**: Track time spent on tasks across sessions

### Open Questions
- Optimal event log retention/archival strategy (currently: keep forever)
- Graph visualization for complex task hierarchies
- Integration with external systems (GitHub issues, Linear, etc.)
- Multi-agent coordination (multiple agents working on same project)

---

## Appendix A: Example Workflow

```
# Initialize arbeit in project
arbeit_init()

# Create an epic
arbeit_task_create(
  title: "Auth Security Improvements",
  intent: "Address security audit findings from Q4"
)
# Returns: tkt-abc001

# Create child tasks
arbeit_task_create(
  title: "Implement session timeout",
  intent: "Users complaining sessions never expire",
  parent_id: "tkt-abc001"
)
# Returns: tkt-abc002

arbeit_task_create(
  title: "Add rate limiting to login",
  parent_id: "tkt-abc001"
)
# Returns: tkt-abc003

# Start working on session timeout
arbeit_task_start_work(task_id: "tkt-abc002")

# Add context as you work
arbeit_context_add(
  task_id: "tkt-abc002",
  type: "decision",
  content: "Using localStorage for last-activity timestamp"
)

arbeit_context_add(
  task_id: "tkt-abc002",
  type: "rationale",
  content: "Simpler than server-side, no backend changes needed"
)

# Track progress
arbeit_progress_add(
  task_id: "tkt-abc002",
  items: ["Create useIdleTimeout hook", "Build SessionWarning component", "Wire up to App.tsx", "Add tests"]
)

# Complete some items
arbeit_progress_complete(item_ids: ["prg-001", "prg-002"])

# Hit a blocker
arbeit_context_add(
  task_id: "tkt-abc002",
  type: "blocker",
  content: "Need user input on timeout duration - 30 min vs 60 min"
)

# Stop work for now
arbeit_task_stop_work(task_id: "tkt-abc002")

# ... later, in a new session ...

# Get briefing to resume
arbeit_task_get(
  task_id: "tkt-abc002",
  include: [
    "parent",
    "children",
    "blocked_by",
    "blocking",
    "context_all",
    "progress_summary",
    "files",
    "sessions",
    "recent_events"
  ]
)
# Returns full context, progress, blockers, etc.

# Continue work
arbeit_task_start_work(task_id: "tkt-abc002")

# Blocker resolved
arbeit_context_add(
  task_id: "tkt-abc002",
  type: "blocker",
  content: "User confirmed 30 minute timeout",
  supersede_entry_id: "ctx-005"
)
```

---

## Appendix B: ID Format

Task IDs follow the format: `tkt-{random}`

Where `{random}` is an 8-character alphanumeric string (lowercase), e.g., `tkt-a7f3b2c1`.

Other entity IDs follow similar patterns:
- Context entries: `ctx-{random}`
- Progress items: `prg-{random}`
- Relationships: `rel-{random}`
- Events: `evt-{random}`
- File associations: `fle-{random}`
- Session links: `ses-{random}`
