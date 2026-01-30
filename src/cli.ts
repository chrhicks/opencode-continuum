#!/usr/bin/env bun
/**
 * CLI for viewing Continuum tasks from the local .continuum directory.
 * 
 * Usage:
 *   bun run cli list [--status=<status>] [--type=<type>]
 *   bun run cli view <task_id>
 */

import { parseArgs } from 'node:util'
import { get_db, list_tasks, get_task, type Task, type TaskStatus, type TaskType } from './db'
import { init_project, init_status } from './util'

const HELP = `
Continuum CLI - Task management from local .continuum directory

Usage:
  continuum init              Initialize continuum in current directory
  continuum list [options]    List tasks
  continuum view <task_id>    View task details
  continuum view <task_id> --tree   View task with all children (for epics)

List Options:
  --status=<status>   Filter by status (open, in_progress, completed, cancelled)
  --type=<type>       Filter by type (epic, feature, bug, investigation, chore)

View Options:
  --tree              Include all child tasks (useful for epics)

Examples:
  continuum init
  continuum list
  continuum list --status=open
  continuum view tkt-abc12345
  continuum view tkt-abc12345 --tree
`

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`
}

function statusColor(status: string): string {
  switch (status) {
    case 'open': return colorize(status, 'blue')
    case 'in_progress': return colorize(status, 'yellow')
    case 'completed': return colorize(status, 'green')
    case 'cancelled': return colorize(status, 'dim')
    default: return status
  }
}

function typeColor(type: string): string {
  switch (type) {
    case 'epic': return colorize(type, 'magenta')
    case 'feature': return colorize(type, 'cyan')
    case 'bug': return colorize(type, 'red')
    case 'investigation': return colorize(type, 'yellow')
    case 'chore': return colorize(type, 'dim')
    default: return type
  }
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function initContinuum() {
  const directory = process.cwd()
  
  const status = await init_status({ directory })
  
  if (status.dbFileExists) {
    console.log(colorize('Continuum is already initialized in this directory.', 'dim'))
    console.log(`Database: ${directory}/.continuum/continuum.db`)
    return
  }

  await init_project({ directory })
  
  success('Initialized continuum in current directory.')
  console.log(`Database: ${directory}/.continuum/continuum.db`)
  console.log()
  console.log('Next steps:')
  console.log(`  ${colorize('continuum list', 'cyan')}              List tasks`)
  console.log(`  ${colorize('continuum view <task_id>', 'cyan')}    View task details`)
}

function success(message: string) {
  console.log(colorize(`✓ ${message}`, 'green'))
}

async function listTasks(options: { status?: string; type?: string }) {
  const directory = process.cwd()
  
  try {
    const db = await get_db(directory)
    const tasks = await list_tasks(db, {
      status: options.status as TaskStatus | undefined,
    })

    // Filter by type if specified (list_tasks doesn't support type filter)
    const filtered = options.type 
      ? tasks.filter(t => t.type === options.type)
      : tasks

    if (filtered.length === 0) {
      console.log(colorize('No tasks found.', 'dim'))
      return
    }

    // Calculate column widths
    const idWidth = Math.max(12, ...filtered.map(t => t.id.length))
    const typeWidth = Math.max(6, ...filtered.map(t => t.type.length))
    const statusWidth = Math.max(11, ...filtered.map(t => t.status.length))

    // Header
    console.log(
      colorize('ID'.padEnd(idWidth), 'bold') + '  ' +
      colorize('Type'.padEnd(typeWidth), 'bold') + '  ' +
      colorize('Status'.padEnd(statusWidth), 'bold') + '  ' +
      colorize('Title', 'bold')
    )
    console.log(colorize('─'.repeat(idWidth + typeWidth + statusWidth + 40), 'dim'))

    // Rows
    for (const task of filtered) {
      const id = task.id.padEnd(idWidth)
      const type = task.type.padEnd(typeWidth)
      const status = task.status.padEnd(statusWidth)
      const title = task.title.length > 50 ? task.title.slice(0, 47) + '...' : task.title

      console.log(
        colorize(id, 'dim') + '  ' +
        typeColor(type) + '  ' +
        statusColor(status) + '  ' +
        title
      )
    }

    console.log(colorize(`\n${filtered.length} task(s)`, 'dim'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'SQLITE_CANTOPEN' || 
        (error as Error).message?.includes('no such file')) {
      console.error(colorize('Error: No .continuum directory found. Run continuum_init first.', 'red'))
      process.exit(1)
    }
    throw error
  }
}

function formatTaskCompact(task: Task, indent: string = ''): string {
  const lines: string[] = []
  
  // Header line: [id] type/status title
  const header = `${indent}${colorize(`[${task.id}]`, 'dim')} ${typeColor(task.type)}/${statusColor(task.status)} ${colorize(task.title, 'bold')}`
  lines.push(header)
  
  // Intent (single line)
  if (task.intent) {
    lines.push(`${indent}  ${colorize('Intent:', 'dim')} ${task.intent}`)
  }
  
  // Blocked by
  if (task.blocked_by.length > 0) {
    lines.push(`${indent}  ${colorize('Blocked by:', 'red')} ${task.blocked_by.join(', ')}`)
  }
  
  // Steps (compact inline)
  if (task.steps.length > 0) {
    const stepMarkers = task.steps.map(s => {
      if (s.status === 'completed') return colorize('✓', 'green')
      if (s.status === 'in_progress') return colorize('→', 'yellow')
      if (s.status === 'skipped') return colorize('○', 'dim')
      return colorize('·', 'dim')
    }).join('')
    const stepNames = task.steps.map(s => s.title || `Step ${s.id}`).join(' → ')
    lines.push(`${indent}  ${colorize('Steps:', 'dim')} [${stepMarkers}] ${colorize(stepNames, 'dim')}`)
  }
  
  // Discoveries count
  if (task.discoveries.length > 0) {
    lines.push(`${indent}  ${colorize('Discoveries:', 'dim')} ${task.discoveries.length}`)
  }
  
  // Decisions count
  if (task.decisions.length > 0) {
    lines.push(`${indent}  ${colorize('Decisions:', 'dim')} ${task.decisions.length}`)
  }
  
  // Outcome (truncated)
  if (task.outcome) {
    const truncated = task.outcome.length > 80 ? task.outcome.slice(0, 77) + '...' : task.outcome
    lines.push(`${indent}  ${colorize('Outcome:', 'green')} ${truncated}`)
  }
  
  return lines.join('\n')
}

async function viewTask(taskId: string, options: { tree?: boolean } = {}) {
  const directory = process.cwd()
  
  try {
    const db = await get_db(directory)
    const task = await get_task(db, taskId)

    if (!task) {
      console.error(colorize(`Error: Task '${taskId}' not found.`, 'red'))
      process.exit(1)
    }

    // Tree view - compact format for agents
    if (options.tree) {
      // Header
      console.log(colorize('═'.repeat(70), 'dim'))
      console.log(`${typeColor(task.type.toUpperCase())}: ${colorize(task.title, 'bold')} ${colorize(`[${task.id}]`, 'dim')} (${statusColor(task.status)})`)
      console.log(colorize('═'.repeat(70), 'dim'))
      
      if (task.intent) {
        console.log(`${colorize('Intent:', 'bold')} ${task.intent}`)
      }
      
      if (task.description) {
        console.log(`${colorize('Description:', 'bold')} ${task.description}`)
      }
      
      if (task.plan) {
        console.log()
        console.log(colorize('Plan:', 'bold'))
        console.log(task.plan)
      }
      
      // Get children
      const children = await list_tasks(db, { parent_id: task.id })
      
      if (children.length > 0) {
        console.log()
        console.log(colorize(`CHILDREN (${children.length}):`, 'bold'))
        console.log()
        
        for (let i = 0; i < children.length; i++) {
          const child = children[i]
          console.log(`${colorize(`[${i + 1}]`, 'bold')} ${formatTaskCompact(child, '    ').trim()}`)
          console.log()
        }
      }
      
      // Summary stats
      const completed = children.filter(c => c.status === 'completed').length
      const inProgress = children.filter(c => c.status === 'in_progress').length
      const open = children.filter(c => c.status === 'open').length
      const blocked = children.filter(c => c.blocked_by.length > 0 && c.status !== 'completed').length
      
      if (children.length > 0) {
        console.log(colorize('─'.repeat(70), 'dim'))
        console.log(`${colorize('Summary:', 'bold')} ${completed}/${children.length} completed, ${inProgress} in progress, ${open} open${blocked > 0 ? `, ${blocked} blocked` : ''}`)
      }
      
      console.log()
      return
    }

    // Standard view - detailed single task
    // Header
    console.log(colorize('═'.repeat(60), 'dim'))
    console.log(colorize(task.title, 'bold'))
    console.log(colorize('═'.repeat(60), 'dim'))
    console.log()

    // Metadata
    console.log(`${colorize('ID:', 'bold')}      ${task.id}`)
    console.log(`${colorize('Type:', 'bold')}    ${typeColor(task.type)}`)
    console.log(`${colorize('Status:', 'bold')}  ${statusColor(task.status)}`)
    console.log(`${colorize('Created:', 'bold')} ${formatDate(task.created_at)}`)
    console.log(`${colorize('Updated:', 'bold')} ${formatDate(task.updated_at)}`)
    
    if (task.parent_id) {
      console.log(`${colorize('Parent:', 'bold')}  ${task.parent_id}`)
    }
    
    if (task.blocked_by.length > 0) {
      console.log(`${colorize('Blocked by:', 'bold')} ${task.blocked_by.join(', ')}`)
    }

    // Intent
    if (task.intent) {
      console.log()
      console.log(colorize('Intent:', 'bold'))
      console.log(task.intent)
    }

    // Description
    if (task.description) {
      console.log()
      console.log(colorize('Description:', 'bold'))
      console.log(task.description)
    }

    // Plan
    if (task.plan) {
      console.log()
      console.log(colorize('Plan:', 'bold'))
      console.log(task.plan)
    }

    // Steps
    if (task.steps.length > 0) {
      console.log()
      console.log(colorize('Steps:', 'bold'))
      for (const step of task.steps) {
        const marker = step.status === 'completed' ? colorize('✓', 'green') :
                       step.status === 'in_progress' ? colorize('→', 'yellow') :
                       step.status === 'skipped' ? colorize('○', 'dim') :
                       colorize('·', 'dim')
        const current = task.current_step === step.id ? colorize(' (current)', 'yellow') : ''
        console.log(`  ${marker} ${step.title || `Step ${step.id}`}${current}`)
        if (step.summary) {
          console.log(colorize(`      ${step.summary}`, 'dim'))
        }
        if (step.notes) {
          console.log(colorize(`      Notes: ${step.notes}`, 'cyan'))
        }
      }
    }

    // Discoveries
    if (task.discoveries.length > 0) {
      console.log()
      console.log(colorize('Discoveries:', 'bold'))
      for (const discovery of task.discoveries) {
        console.log(`  ${colorize('•', 'cyan')} ${discovery.content}`)
        console.log(colorize(`    ${formatDate(discovery.created_at)}`, 'dim'))
      }
    }

    // Decisions
    if (task.decisions.length > 0) {
      console.log()
      console.log(colorize('Decisions:', 'bold'))
      for (const decision of task.decisions) {
        console.log(`  ${colorize('•', 'magenta')} ${decision.content}`)
        if (decision.rationale) {
          console.log(colorize(`    Rationale: ${decision.rationale}`, 'dim'))
        }
        console.log(colorize(`    ${formatDate(decision.created_at)}`, 'dim'))
      }
    }

    // Outcome
    if (task.outcome) {
      console.log()
      console.log(colorize('Outcome:', 'bold'))
      console.log(colorize(task.outcome, 'green'))
    }

    console.log()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'SQLITE_CANTOPEN' || 
        (error as Error).message?.includes('no such file')) {
      console.error(colorize('Error: No .continuum directory found. Run continuum_init first.', 'red'))
      process.exit(1)
    }
    throw error
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      status: { type: 'string', short: 's' },
      type: { type: 'string', short: 't' },
      tree: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (values.help || positionals.length === 0) {
    console.log(HELP)
    process.exit(0)
  }

  const command = positionals[0]

  switch (command) {
    case 'init':
      await initContinuum()
      break

    case 'list':
      await listTasks({ status: values.status, type: values.type })
      break

    case 'view':
    case 'get':
      const taskId = positionals[1]
      if (!taskId) {
        console.error(colorize('Error: Task ID required.', 'red'))
        console.log('Usage: continuum view <task_id> [--tree]')
        process.exit(1)
      }
      await viewTask(taskId, { tree: values.tree })
      break

    default:
      console.error(colorize(`Error: Unknown command '${command}'`, 'red'))
      console.log(HELP)
      process.exit(1)
  }
}

main().catch((error) => {
  console.error(colorize(`Error: ${error.message}`, 'red'))
  process.exit(1)
})
