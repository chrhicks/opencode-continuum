# Continuum (Agent Guide)

Continuum is an agent-first task system that stores work context so tasks can be resumed across sessions.

To begin, call `continuum_init` before any other tool.

## Core Workflow

### 1. Plan
Create a task with intent (why), description (what), and plan (how):
```
continuum_task_create({
  title: "Add dark mode",
  template: "feature",
  intent: "Users want to reduce eye strain",
  description: "Add theme toggle to settings page",
  plan: "Use CSS variables for theming, React Context for state"
})
```

### 2. Break Down
Add execution steps derived from your plan:
```
continuum_step_add({
  task_id: "tkt_xxx",
  steps: [
    { action: "Create ThemeContext" },
    { action: "Add toggle component" },
    { action: "Implement CSS variables" }
  ]
})
```

### 3. Execute
Work through steps one at a time. Complete each step as you finish:
```
continuum_step_complete({
  task_id: "tkt_xxx",
  notes: "Used Zustand instead of Context for simpler API"
})
```

**Record discoveries and decisions as you go** — this is critical for session resumption:
```
continuum_task_discover({
  task_id: "tkt_xxx",
  content: "Third-party date picker doesn't support CSS variables"
})

continuum_task_decide({
  task_id: "tkt_xxx",
  content: "Use inline styles for date picker",
  rationale: "Only component that needs override"
})
```

#### What to Record

**Discoveries** — things you learned that weren't obvious from the plan:
- Unexpected API behavior or limitations
- Missing dependencies or version conflicts
- Existing code patterns you need to follow
- Edge cases you encountered

**Decisions** — choices you made during implementation:
- Why you picked one approach over another
- Trade-offs you accepted
- Deviations from the original plan
- Workarounds for blockers

Even small decisions matter. A future session (or different agent) will lack your context — recordings bridge that gap.

### 4. Complete
When all steps are done, complete the task with an outcome summary:
```
continuum_task_complete({
  task_id: "tkt_xxx",
  outcome: "Dark mode shipped. Used Zustand instead of Context. Date picker required inline style workaround."
})
```

## Resuming Work

When starting a session, check for active tasks:
```
continuum_query({ query: "active_tasks" })
```

Then fetch the task to see current state:
```
continuum_task_get({ task_id: "tkt_xxx" })
```

The response includes:
- `current_step` - which step to work on next
- `steps` - all steps with their status and notes
- `discoveries` - things learned during execution
- `decisions` - choices made with rationale
- `plan` - the original approach for reference

## Tools Reference

| Tool | Purpose |
|------|---------|
| `continuum_init` | Initialize database (once per project) |
| `continuum_task_create` | Create a task with planning fields |
| `continuum_task_get` | Fetch task with full context |
| `continuum_task_update` | Update planning fields |
| `continuum_step_add` | Add execution steps |
| `continuum_step_complete` | Mark step done, auto-advance |
| `continuum_step_update` | Modify step action/status/notes |
| `continuum_task_discover` | Record a discovery |
| `continuum_task_decide` | Record a decision with rationale |
| `continuum_task_complete` | Finalize with outcome summary |
| `continuum_task_cancel` | Cancel task with reason |
| `continuum_query` | List/filter tasks |

## Key Principles

1. **Plan is strategy, steps are tactics** - The plan describes the approach; steps are the concrete actions.
2. **Execute step by step** - Complete one step before moving to the next.
3. **Record as you go** - Discoveries and decisions capture context for future sessions.
4. **Outcome captures reality** - The outcome shows what actually happened vs. what was planned.
