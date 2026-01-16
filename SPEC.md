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
Initialize arbeit in the current directory.

**Parameters:** None

**Returns:** `{ initialized: boolean, path: string }`

**Errors:**
- `ALREADY_INITIALIZED`: `.arbeit/` already exists

---

### 5.2 Task Management

#### `arbeit_task_create`
Create a new task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | yes | Brief description |
| `intent` | string | no | The "why" (immutable after creation) |
| `parent_id` | string | no | Parent task ID for hierarchy |
| `status` | string | no | Initial status (default: `open`) |

**Returns:** `{ task: Task }`

**Errors:**
- `PARENT_NOT_FOUND`: Specified parent task doesn't exist
- `MAX_DEPTH_EXCEEDED`: Would exceed 4-level hierarchy limit

---

#### `arbeit_task_get`
Get a task by ID.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |

**Returns:** `{ task: Task, relationships: Relationship[], context: ContextEntry[], progress: ProgressItem[] }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist

---

#### `arbeit_task_update`
Update a task's properties.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |
| `title` | string | no | New title |
| `status` | string | no | New status |

**Returns:** `{ task: Task }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `INVALID_STATUS`: Status not one of: `open`, `in_progress`, `completed`, `cancelled`

**Warnings:**
- `HAS_INCOMPLETE_CHILDREN`: Completing a task with incomplete children

---

#### `arbeit_task_delete`
Delete a task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |

**Returns:** `{ deleted: boolean }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `HAS_CHILDREN`: Task has child tasks (must delete or re-parent children first)

---

#### `arbeit_task_list`
List tasks with optional filters.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `status` | string | no | Filter by status |
| `parent_id` | string | no | Filter by parent (use `null` for root tasks) |

**Returns:** `{ tasks: Task[] }`

---

### 5.3 Work Session Management

#### `arbeit_task_start_work`
Signal that the agent is starting work on a task. This:
- Sets task status to `in_progress` (if currently `open`)
- Links the current OpenCode session to the task
- Enables automatic file tracking for this session

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |

**Returns:** `{ task: Task, session_linked: boolean }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `ALREADY_WORKING`: This session is already working on a different task

---

#### `arbeit_task_stop_work`
Signal that the agent is done working on a task (for this session).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |

**Returns:** `{ stopped: boolean, files_tracked: number }`

---

### 5.4 Context Management

#### `arbeit_context_add`
Add a context entry to a task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |
| `type` | string | yes | Entry type (see 2.2) |
| `content` | string | yes | The content |
| `metadata` | object | no | Additional structured data |

**Returns:** `{ entry: ContextEntry }`

**Errors:**
- `TASK_NOT_FOUND`: Task doesn't exist
- `INVALID_TYPE`: Type not recognized

---

#### `arbeit_context_supersede`
Mark a context entry as superseded by a new entry.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `entry_id` | string | yes | The entry being superseded |
| `new_content` | string | yes | The new content |
| `type` | string | no | New type (defaults to same as original) |

**Returns:** `{ old_entry: ContextEntry, new_entry: ContextEntry }`

**Errors:**
- `ENTRY_NOT_FOUND`: Entry doesn't exist
- `ALREADY_SUPERSEDED`: Entry was already superseded

---

### 5.5 Progress Management

#### `arbeit_progress_add`
Add progress items to a task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |
| `items` | string[] | yes | List of work items |
| `completed` | boolean | no | Whether items are already completed (default: false) |

**Returns:** `{ items: ProgressItem[] }`

---

#### `arbeit_progress_complete`
Mark progress items as completed.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `item_ids` | string[] | yes | IDs of items to complete |

**Returns:** `{ completed: ProgressItem[] }`

---

### 5.6 Relationship Management

#### `arbeit_relationship_add`
Create a relationship between tasks.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `from_task_id` | string | yes | Source task |
| `to_task_id` | string | yes | Target task |
| `type` | string | yes | Relationship type (see 2.3) |
| `metadata` | object | no | Additional data (e.g., reason) |

**Returns:** `{ relationship: Relationship }`

**Errors:**
- `TASK_NOT_FOUND`: One of the tasks doesn't exist
- `CIRCULAR_DEPENDENCY`: Would create a cycle (for `blocks` relationships)
- `RELATIONSHIP_EXISTS`: This relationship already exists
- `INVALID_TYPE`: Relationship type not recognized

---

#### `arbeit_relationship_remove`
Remove a relationship between tasks.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `from_task_id` | string | yes | Source task |
| `to_task_id` | string | yes | Target task |
| `type` | string | yes | Relationship type |

**Returns:** `{ removed: boolean }`

---

### 5.7 Queries

#### `arbeit_query`
Execute a named query.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Query name |
| `params` | object | no | Query parameters |

**Available Queries:**

| Query Name | Parameters | Description |
|------------|------------|-------------|
| `blocked_tasks` | `status?` | Tasks that are blocked by other tasks |
| `blocking_tasks` | `status?` | Tasks that are blocking other tasks |
| `children_of` | `task_id` | Direct children of a task |
| `descendants_of` | `task_id` | All descendants (recursive) |
| `ancestors_of` | `task_id` | All ancestors (recursive) |
| `root_tasks` | `status?` | Tasks with no parent |
| `recent_activity` | `since`, `task_id?` | Recent context entries and progress |
| `stale_tasks` | `days` | Tasks not updated in N days |
| `files_for_task` | `task_id` | Files associated with a task |
| `tasks_for_file` | `file_path` | Tasks that touched a file |

**Returns:** Query-specific results

---

#### `arbeit_briefing`
Get a comprehensive briefing for resuming work on a task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID |

**Returns:**
```typescript
{
  task: Task;
  parent?: Task;
  children: Task[];
  blocked_by: Task[];
  blocking: Task[];
  context: ContextEntry[];  // ordered by date, superseded entries excluded unless requested
  progress: {
    completed: ProgressItem[];
    remaining: ProgressItem[];
  };
  files: FileAssociation[];
  sessions: SessionLink[];
  recent_events: Event[];  // last N events for this task
}
```

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
| `TASK_NOT_FOUND` | Task ID doesn't exist | Check task ID, use `arbeit_task_list()` |
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
arbeit_briefing(task_id: "tkt-abc002")
# Returns full context, progress, blockers, etc.

# Continue work
arbeit_task_start_work(task_id: "tkt-abc002")

# Blocker resolved
arbeit_context_supersede(
  entry_id: "ctx-005",
  new_content: "User confirmed 30 minute timeout"
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
