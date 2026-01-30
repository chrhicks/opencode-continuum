# opencode-continuum

opencode-continuum is a simple task management tool for your agent. It provides tools to create tasks and manage the relationship between them.

## Features
- Create typed tasks with intent, description, and plan fields
- Enforce status transitions with validation and recommendations
- Model parent-child hierarchy and blocked-by relationships
- Query tasks and discover template recommendations
- Persist task state in `.continuum/continuum.db`

## Install (Local plugin file)
1. Clone this repo and install dependencies:

```bash
bun install
```

2. Build the plugin bundle (output: `.opencode/plugins/continuum.ts`):

```bash
bun run build
# or: bun run build --no-test
```

3. Copy or symlink the bundle into your target project:

```
<target-project>/.opencode/plugins/continuum.ts
```

4. Ensure your target project has an `opencode.json` config (minimum):

```json
{
  "$schema": "https://opencode.ai/config.json"
}
```

5. Start OpenCode in the target project.

## Usage
Initialize once per repo:

```ts
continuum_init()
```

Create and query tasks:

```ts
continuum_task_create({
  title: "Draft release checklist",
  type: "feature",
  intent: "Track publish steps",
  description: "Create a checklist for the GitHub release workflow.",
  plan: `Plan:\n- Changes:\n  - ...\n- Files:\n  - ...\n- Tests:\n  - ...\n- Risks:\n  - ...`
})

continuum_query({ query: "tasks" })
```

## How It Works
- Adds a small SQLite-backed task store at `.continuum/continuum.db` per repo.
- Agents create, update, and query tasks through OpenCode tools.
- Tasks track intent, description, plan, and dependencies so work can resume later.
- Status transitions are validated (e.g., plans required before moving to `in_progress`).

## CLI

View tasks from the command line.

### Install globally

```bash
# Install to ~/.local/bin
./install.sh

# Or install to /usr/local/bin (requires sudo)
./install.sh --global

# Uninstall
./install.sh --uninstall
```

Ensure `~/.local/bin` is in your PATH:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Usage

```bash
# Initialize continuum in current directory
continuum init

# List all tasks
continuum list

# Filter by status or type
continuum list --status=open
continuum list --type=feature

# View task details
continuum view <task_id>

# View epic with all children (compact format for agents)
continuum view <task_id> --tree

# Help
continuum --help
```

### Development

Run without installing:

```bash
bun run cli list
bun run cli view <task_id>
```

## TODO
- Add npm distribution and CLI installer instructions.

## License

MIT
