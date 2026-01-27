## Core Workflow

### 1. Plan

Create a task with intent (why), description (what), and plan (how):

```
continuum_task_create({
  title: "Add dark mode",
  template: "feature",
  intent: "Users have requested dark mode to reduce eye strain during night usage. This is a top-requested accessibility feature.",
  description: "Add a theme toggle to the settings page that switches between light and dark modes, persisting the preference across sessions.",
  plan: "Use CSS custom properties for theming (avoids runtime style recalculation). Store preference in localStorage. Steps: 1) Define color tokens as CSS vars, 2) Create ThemeContext with toggle, 3) Add toggle UI to settings, 4) Wire up localStorage persistence"
})
```

### 2. Break Down

Add execution steps derived from your plan. Each step should have:
- **title**: Short step name
- **summary**: 1-2 sentence description of what this step accomplishes
- **details**: Full specification with files, functions, APIs, specific values — enough detail for any agent to execute blindly

```
continuum_step_add({
  task_id: "tkt_xxx",
  steps: [
    {
      title: "Define CSS custom properties",
      summary: "Create theme tokens as CSS variables with light/dark selectors.",
      details: "Create src/styles/theme.css with :root selector for light theme defaults and [data-theme='dark'] selector for dark overrides. Define tokens: --color-bg (#ffffff / #1a1a1a), --color-text (#111111 / #f0f0f0), --color-primary (#0066cc / #66b3ff), --color-border (#dddddd / #333333). Import this file in the app entry point."
    },
    {
      title: "Create ThemeContext",
      summary: "Build context provider and hook for theme state management.",
      details: "Create src/context/ThemeContext.tsx. Export ThemeProvider component and useTheme hook. State holds 'light' | 'dark'. Provide toggle() function that switches theme and updates document.documentElement.dataset.theme. Initialize from localStorage on mount, default to 'light'."
    },
    {
      title: "Add ThemeToggle component",
      summary: "Build the UI toggle for the settings page.",
      details: "Create src/components/settings/ThemeToggle.tsx. Render a switch or button that displays current theme. On click, call useTheme().toggle(). Show sun/moon icon based on current state. Add to existing SettingsPage component in the Appearance section."
    },
    {
      title: "Wire up localStorage persistence",
      summary: "Persist theme preference across browser sessions.",
      details: "In ThemeContext, read localStorage key 'user-theme-preference' on mount (default 'light' if missing). On every theme change, write to the same key. Ensure hydration doesn't cause flash — apply theme before first render."
    }
  ]
})
```

### 3. Execute

Work through steps one at a time. Complete each step with notes on what actually happened:

```
continuum_step_complete({
  task_id: "tkt_xxx",
  notes: "Switched from React Context to Zustand for state management. Context required too much boilerplate for a simple toggle. Created src/store/theme.ts with useThemeStore hook. Toggle and persistence working as specified."
})
```

**Record discoveries and decisions as you go** — this is critical for session resumption:

```
continuum_task_discover({
  task_id: "tkt_xxx",
  content: "The third-party date picker (react-datepicker v4.8) doesn't support CSS custom properties — it uses inline styles that override CSS variables. Tested by setting --color-bg on .react-datepicker wrapper, no effect. GitHub issue #3421 confirms this is a known limitation with no fix planned."
})

continuum_task_decide({
  task_id: "tkt_xxx",
  content: "Use inline styles to theme the date picker instead of CSS variables",
  rationale: "Only one component needs this workaround. Alternatives considered: (1) fork the library — too much maintenance burden, (2) use a different date picker — would require reworking existing date logic, (3) leave it unthemed — breaks the dark mode experience. Inline styles are the smallest scoped fix."
})
```

#### What to Record

**Discoveries** — things you learned that weren't obvious from the plan:
- Unexpected API behavior or limitations (with specific error messages, version numbers)
- Missing dependencies or version conflicts
- Existing code patterns you need to follow
- Edge cases you encountered
- Links to relevant docs, issues, or discussions

**Decisions** — choices you made during implementation:
- What you decided and why
- What alternatives you considered and rejected
- Trade-offs you accepted
- Deviations from the original plan
- Workarounds for blockers

Even small decisions matter. A future session (or different agent) will lack your context — recordings bridge that gap.

### 4. Complete

When all steps are done, complete the task with an outcome summary that captures what shipped, how it differed from the plan, and key learnings:

```
continuum_task_complete({
  task_id: "tkt_xxx",
  outcome: "Dark mode shipped and working. Deviated from plan: used Zustand instead of React Context for simpler API (fewer files, no provider nesting). Key discovery: react-datepicker doesn't support CSS variables, required inline style workaround — future theming work should audit third-party components first. All four steps completed, localStorage persistence verified across browser restart."
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

Example response:

```json
{
  "id": "tkt_abc123",
  "title": "Add dark mode",
  "status": "in_progress",
  "intent": "Users have requested dark mode to reduce eye strain during night usage. This is a top-requested accessibility feature.",
  "description": "Add a theme toggle to the settings page that switches between light and dark modes, persisting the preference across sessions.",
  "plan": "Use CSS custom properties for theming (avoids runtime style recalculation). Store preference in localStorage. Steps: 1) Define color tokens as CSS vars, 2) Create ThemeContext with toggle, 3) Add toggle UI to settings, 4) Wire up localStorage persistence",
  "current_step": 3,
  "steps": [
    {
      "id": 1,
      "title": "Define CSS custom properties",
      "summary": "Create theme tokens as CSS variables with light/dark selectors.",
      "details": "Create src/styles/theme.css with :root selector for light theme...",
      "status": "completed",
      "notes": "Done as specified, added --color-accent as well."
    },
    {
      "id": 2,
      "title": "Create ThemeContext",
      "summary": "Build context provider and hook for theme state management.",
      "details": "Create src/context/ThemeContext.tsx...",
      "status": "completed",
      "notes": "Switched to Zustand instead of Context for simpler API."
    },
    {
      "id": 3,
      "title": "Add ThemeToggle component",
      "summary": "Build the UI toggle for the settings page.",
      "details": "Create src/components/settings/ThemeToggle.tsx...",
      "status": "in_progress",
      "notes": null
    },
    {
      "id": 4,
      "title": "Wire up localStorage persistence",
      "summary": "Persist theme preference across browser sessions.",
      "details": "In ThemeContext, read localStorage key 'user-theme-preference'...",
      "status": "pending",
      "notes": null
    }
  ],
  "discoveries": [
    {
      "id": 1,
      "content": "The third-party date picker (react-datepicker v4.8) doesn't support CSS custom properties...",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "decisions": [
    {
      "id": 1,
      "content": "Use inline styles to theme the date picker instead of CSS variables",
      "rationale": "Only one component needs this workaround...",
      "created_at": "2024-01-15T10:35:00Z"
    }
  ]
}
```

**Before continuing, review:**

1. Read the `plan` to understand the overall approach
2. Check `discoveries` for things learned that may affect remaining work
3. Check `decisions` for choices already made (don't re-litigate)
4. Look at `current_step` and its `details` to see exactly what to do next
5. Review completed steps' `notes` for any context that carries forward

## Tools Reference

| Tool | Purpose |
|------|---------|
| `continuum_init` | Initialize database (required before other tools) |
| `continuum_task_create` | Create a task with intent, description, and plan |
| `continuum_task_get` | Fetch task with full context, steps, discoveries, decisions |
| `continuum_task_update` | Update task fields (title, description, plan, status, etc.) |
| `continuum_step_add` | Add execution steps with title, summary, and details |
| `continuum_step_complete` | Mark step done with notes, auto-advance to next |
| `continuum_step_update` | Modify step title, summary, details, status, or notes |
| `continuum_task_discover` | Record a discovery with full context and evidence |
| `continuum_task_decide` | Record a decision with rationale and alternatives considered |
| `continuum_task_complete` | Finalize with outcome: result, deviations, learnings |
| `continuum_task_delete` | Soft delete a task |
| `continuum_query` | List/filter tasks (tasks, active_tasks, children_of, etc.) |

## Key Principles

1. **Detail enables resumption** — A future session (or different agent) has no memory of your context. The quality of what you record directly determines how effectively work can continue. Be thorough.

2. **Steps are executable specs** — Each step should have enough detail that any agent could execute it without guessing. Title, summary, and details — if the details are vague, the step isn't ready.

3. **Record as you go, not after** — Capture discoveries and decisions in the moment. If you wait until the end, you'll forget the nuance, the alternatives you rejected, the evidence you found.

4. **Plan first, then steps** — Establish the approach before breaking it into steps. The plan captures key decisions and the overall strategy; steps are the tactical execution.

5. **Outcome vs plan matters** — When completing a task, explicitly note what differed from the plan. This is where learning happens — the delta between intent and reality.

6. **One step at a time** — Complete the current step before moving to the next. This keeps execution focused and ensures notes are captured while context is fresh.
