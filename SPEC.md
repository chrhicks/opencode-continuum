# Arbeit - Simplified Agent Task Model

## 1. Overview

Arbeit simplifies the system to a single, richer task entity. The goal is to reduce meta-planning and force actionable technical detail at the task level while keeping the interface minimal.

### Design Goals
- **Concrete detail by default**: implementation-like tasks must include a plan before execution.
- **Simple relationships**: parent-child hierarchy plus a single blocker reference.
- **Single source of truth**: no separate context or progress tables; essential detail lives on the task.
- **Agent-friendly**: minimal tooling, explicit state transitions, and deterministic validation.

---

## 2. Task Model

### 2.1 Task

A task is the sole unit of work and the container for resumable context. It includes both intent and implementation detail.

**Fields:**
- `id`: string
- `title`: string
- `type`: `epic | feature | bug | investigation | chore`
- `status`: `open | in_progress | completed | cancelled`
- `intent`: string (why)
- `description`: string (what)
- `plan`: string (how)
- `parent_id`: string | null (single parent)
- `blocked_by`: string[] (blocking task IDs; empty = not blocked)
- `created_at`: ISO timestamp
- `updated_at`: ISO timestamp

### 2.2 Task Types

| Type | Purpose | Required Fields |
|------|---------|-----------------|
| `epic` | High-level initiative | `intent`, `description` |
| `feature` | User-facing capability | `intent`, `description`, `plan` |
| `bug` | Fix broken behavior | `intent`, `description`, `plan` |
| `investigation` | Explore/decide | `description`, `plan` |
| `chore` | Maintenance/ops/cleanup | `description`, `plan` |

---

## 3. Templates (Tool-Assisted)

Templates make tasks more approachable ("file a bug", "create investigation"). Templates provide recommended plan structures but are not enforced.

### 3.0 Template Discovery

Templates are discoverable in two ways:
- Tool schema: `arbeit_task_create` exposes a `template` enum with descriptions.
- Query API: `arbeit_query({ query: "templates" })` returns names and plan stubs.

### 3.1 Template Map

| Template | Task Type | Notes |
|----------|-----------|-------|
| `epic` | `epic` | High-level scope and goals |
| `feature` | `feature` | Implementation-focused |
| `bug` | `bug` | Requires repro and verification |
| `investigation` | `investigation` | Requires a research plan |
| `chore` | `chore` | Operational or maintenance work |

### 3.2 Plan Templates (Recommended)

**Epic**
```
Plan:
- Goals:
  - <outcomes to deliver>
- Milestones:
  - <major phases/modules>
- Dependencies:
  - <blocking work>
```

**Feature**
```
Plan:
- Changes:
  - <steps>
- Files:
  - <files or areas>
- Tests:
  - <tests to run/add>
- Risks:
  - <edge cases>
```

**Bug**
```
Plan:
- Repro:
  - <steps>
- Fix:
  - <approach>
- Tests:
  - <coverage>
- Verify:
  - <validation steps>
```

**Investigation**
```
Plan:
- Questions:
  - <what to answer>
- Sources:
  - <files/docs/experiments>
- Output:
  - <decision + recommendation>
```

**Chore**
```
Plan:
- Changes:
  - <steps>
- Files:
  - <files or areas>
- Tests:
  - <tests to run>
- Safety:
  - <backups/rollback>
```

---

## 4. Relationships

### 4.1 Hierarchy
- `parent_id` creates a parent -> child relationship.
- Only one parent per task.

### 4.2 Blocking
- `blocked_by` references one or more tasks that must complete first.
- A task is considered blocked when any referenced blocker is incomplete.

---

## 5. Validation Rules

### 5.1 Create/Update Validation
- `title` is always required.
- Required fields are enforced based on `type`.

### 5.2 Status Transition Validation
- Moving to `in_progress`:
  - `feature`, `bug`, `investigation`, `chore` must have a `plan`.
- Moving to `completed`:
  - `description` is required for all types.
  - `plan` is required for `feature`, `bug`, `investigation`, `chore`.

### 5.3 Dependency Validation
- `blocked_by` must reference existing tasks.
- `parent_id` must reference an existing task.

---

## 6. Recommendation Delivery

Recommendations are returned by tools as structured data for the agent to consume. They are not enforced.

**Mechanism:**
- `arbeit_task_create` and `arbeit_task_update` may return `recommendations` in the response when:
  - a template is used, or
  - required fields are missing for the selected type.

**Shape:**
```
{ task: Task, recommendations?: { plan_template?: string, missing_fields?: string[] } }
```

This is how agents receive recommended plan templates and learn what to fill in next.

---

## 7. Tool API

### 7.1 Initialization

#### `arbeit_init`
Initialize the project database.

**Returns:** `{ initialized: boolean, path: string }`

---

### 7.2 Task Management

#### `arbeit_task_create`
Create a new task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | yes | Short task label. |
| `type` | string | no | Task type. |
| `template` | string | no | Template name (epic/feature/bug/investigation/chore). Exposed in tool schema for discovery. |
| `intent` | string | no | Why this task exists. |
| `description` | string | no | What the task does. |
| `plan` | string | no | How to implement. |
| `parent_id` | string | no | Parent task ID. |
| `blocked_by` | string[] | no | Blocking task IDs. |
| `status` | string | no | Initial status. |

**Notes:**
- If `template` is provided and `type` is omitted, `type` is inferred from the template.
- If both are provided and conflict, return `INVALID_TEMPLATE`.

**Returns:** `{ task: Task, recommendations?: { plan_template?: string, missing_fields?: string[] } }`

---

#### `arbeit_task_get`
Fetch a task by ID.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID. |

**Returns:** `{ task: Task, parent?: Task, children?: Task[], blocking?: Task | null }`

---

#### `arbeit_task_update`
Update task fields or status.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID. |
| `title` | string | no | Updated title. |
| `type` | string | no | Updated type. |
| `intent` | string | no | Updated intent. |
| `description` | string | no | Updated description. |
| `plan` | string | no | Updated plan. |
| `status` | string | no | Updated status. |
| `parent_id` | string | no | Updated parent ID. |
| `blocked_by` | string[] | no | Updated blocking IDs. |

**Returns:** `{ task: Task, recommendations?: { plan_template?: string, missing_fields?: string[] } }`

---

#### `arbeit_task_delete`
Soft delete a task.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | string | yes | Task ID. |

**Returns:** `{ deleted: boolean }`

---

### 7.3 Queries

#### `arbeit_query`
List or graph queries.

**Available Queries:**
| Query | Parameters | Description |
|-------|------------|-------------|
| `tasks` | `status?`, `parent_id?` | List tasks |
| `active_tasks` | `parent_id?` | `open` + `in_progress` |
| `templates` | none | List available task templates and plan stubs |
| `children_of` | `task_id` | Direct children |
| `ancestors_of` | `task_id` | All ancestors |
| `descendants_of` | `task_id` | All descendants |

---

## 8. Errors

### Error Codes
| Code | Description |
|------|-------------|
| `TASK_NOT_FOUND` | Task ID does not exist |
| `INVALID_STATUS` | Invalid status value |
| `INVALID_TYPE` | Invalid task type |
| `INVALID_TEMPLATE` | Template not recognized or conflicts with type |
| `TITLE_REQUIRED` | Title missing |
| `INTENT_REQUIRED` | Intent missing |
| `DESCRIPTION_REQUIRED` | Description missing |
| `PLAN_REQUIRED` | Plan missing |
| `BLOCKER_NOT_FOUND` | `blocked_by` references missing task(s) |
| `INVALID_BLOCKER` | `blocked_by` references itself |
| `DUPLICATE_BLOCKERS` | `blocked_by` contains duplicate task IDs |
| `PARENT_NOT_FOUND` | `parent_id` references missing task |

---

## 9. Validation Logic (TypeScript Sketch)

```
function requireField(value: string | undefined, code: string) {
  if (!value || !value.trim()) throw new Error(code)
}

function validateTaskInput(input: TaskInput) {
  requireField(input.title, 'TITLE_REQUIRED')

  switch (input.type) {
    case 'epic':
      requireField(input.intent, 'INTENT_REQUIRED')
      requireField(input.description, 'DESCRIPTION_REQUIRED')
      break
    case 'feature':
    case 'bug':
      requireField(input.intent, 'INTENT_REQUIRED')
      requireField(input.description, 'DESCRIPTION_REQUIRED')
      requireField(input.plan, 'PLAN_REQUIRED')
      break
    case 'investigation':
      requireField(input.description, 'DESCRIPTION_REQUIRED')
      requireField(input.plan, 'PLAN_REQUIRED')
      break
    case 'chore':
      requireField(input.description, 'DESCRIPTION_REQUIRED')
      requireField(input.plan, 'PLAN_REQUIRED')
      break
  }
}

function validateStatusTransition(task: Task, nextStatus: TaskStatus) {
  if (nextStatus === 'in_progress') {
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      requireField(task.plan, 'PLAN_REQUIRED')
    }
  }

  if (nextStatus === 'completed') {
    requireField(task.description, 'DESCRIPTION_REQUIRED')
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      requireField(task.plan, 'PLAN_REQUIRED')
    }
  }
}
```
