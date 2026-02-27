#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// --- arg parsing ---

const args = process.argv.slice(2);

if (args.includes('--tk-describe')) {
  console.log('tk-plugin: Kanban-style board view');
  process.exit(0);
}

if (args.includes('-h') || args.includes('--help')) {
  const usage = `Usage: tk board [options]

Display tickets grouped by status in a kanban-style board view.

Options:
  -a, --assignee NAME   Filter to a single assignee
  -T, --tag TAG         Filter to tickets with a specific tag
  --no-closed           Hide the closed column
  --me                  Filter to tickets assigned to current worker
  --color=MODE          Color output: always, never, auto (default: auto)
  -h, --help            Show this help

Environment:
  FORCE_COLOR=1         Enable colors even when not a TTY
  NO_COLOR              Disable colors`;
  console.log(usage);
  process.exit(0);
}

let filterAssignee = null;
let filterTag = null;
let showClosed = true;
let filterMe = false;
let forceColor = null; // null = auto, true = always, false = never

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-a': case '--assignee':
      filterAssignee = args[++i]; break;
    case '-T': case '--tag':
      filterTag = args[++i]; break;
    case '--no-closed':
      showClosed = false; break;
    case '--me':
      filterMe = true; break;
    case '--color':
      forceColor = (args[++i] !== 'never'); break;
    case '--color=always':
      forceColor = true; break;
    case '--color=never':
      forceColor = false; break;
    case '--color=auto':
      forceColor = null; break;
    default:
      if (args[i].startsWith('-')) {
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
      }
      break;
  }
}

// --- tickets dir resolution ---

function findTicketsDir() {
  const envDir = process.env.TICKETS_DIR;
  if (envDir) return envDir;

  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, '.tickets');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  console.error('Error: no .tickets directory found (searched parent directories)');
  process.exit(1);
}

const ticketsDir = findTicketsDir();

// --- parse tickets ---

function parseTicket(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  const fields = {};
  for (const line of frontmatter.split('\n')) {
    const m = line.match(/^([a-z][a-z0-9_-]*): ?(.*)$/);
    if (m) {
      fields[m[1]] = m[2];
    }
  }

  // Extract title from first # heading
  const titleMatch = body.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : '(no title)';

  // Parse tags from [tag1, tag2] format
  let tags = [];
  if (fields.tags) {
    const cleaned = fields.tags.replace(/^\[|\]$/g, '');
    tags = cleaned.split(',').map(t => t.trim()).filter(Boolean);
  }

  // Parse pull_request field
  const pr = fields['pull_request'] || fields['pull-request'] || null;

  return {
    id: fields.id || path.basename(filePath, '.md'),
    status: fields.status || 'open',
    priority: fields.priority !== undefined ? parseInt(fields.priority, 10) : 2,
    assignee: fields.assignee || null,
    title,
    tags,
    pr,
  };
}

function loadAllTickets() {
  let entries;
  try {
    entries = fs.readdirSync(ticketsDir);
  } catch {
    console.error(`Error: cannot read ${ticketsDir}`);
    process.exit(1);
  }

  const tickets = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const ticket = parseTicket(path.join(ticketsDir, entry));
    if (ticket) tickets.push(ticket);
  }
  return tickets;
}

// --- filtering ---

function inferMe() {
  // Infer current worker from cwd folder name
  return path.basename(process.cwd());
}

function applyFilters(tickets) {
  let result = tickets;

  const assignee = filterMe ? inferMe() : filterAssignee;
  if (assignee) {
    result = result.filter(t => t.assignee && t.assignee.toLowerCase() === assignee.toLowerCase());
  }

  if (filterTag) {
    result = result.filter(t => t.tags.some(tag => tag.toLowerCase() === filterTag.toLowerCase()));
  }

  return result;
}

// --- formatting ---

function formatPR(pr) {
  if (!pr) return null;
  return pr;
}

function useColor() {
  if (forceColor !== null) return forceColor;
  if (process.env.FORCE_COLOR) return true;
  if (process.env.NO_COLOR !== undefined) return false;
  return process.stdout.isTTY === true;
}

const colors = {
  bold: (s) => useColor() ? `\x1b[1m${s}\x1b[0m` : s,
  red: (s) => useColor() ? `\x1b[31m${s}\x1b[0m` : s,
  dim: (s) => useColor() ? `\x1b[2m${s}\x1b[0m` : s,
  cyan: (s) => useColor() ? `\x1b[36m${s}\x1b[0m` : s,
  green: (s) => useColor() ? `\x1b[32m${s}\x1b[0m` : s,
  blueUnderline: (s) => useColor() ? `\x1b[34;4m${s}\x1b[0m` : s,
};

function colorPriority(p) {
  const label = `P${p}`;
  if (p <= 1) return colors.red(label);
  if (p === 2) return label;
  return colors.dim(label);
}

function renderCard(ticket, colWidth) {
  const lines = [];
  const maxTextWidth = colWidth - 1;

  // Line 1: ID and priority
  const line1 = `${ticket.id}  ${colorPriority(ticket.priority)}`;
  lines.push(line1);

  // Line 2: Title (truncated)
  const title = ticket.title.length > maxTextWidth
    ? ticket.title.slice(0, maxTextWidth - 1) + '\u2026'
    : ticket.title;
  lines.push(title);

  // Line 3: Assignee and tags
  const parts = [];
  if (ticket.assignee) parts.push(colors.green(`@${ticket.assignee}`));
  for (const tag of ticket.tags) parts.push(colors.cyan(`#${tag}`));
  if (parts.length) lines.push(parts.join('  '));

  // Line 4: PR link (if present) — truncated to column width, still clickable if fits
  const pr = formatPR(ticket.pr);
  if (pr) {
    const display = pr.length > maxTextWidth
      ? pr.slice(0, maxTextWidth - 1) + '\u2026'
      : pr;
    lines.push(colors.blueUnderline(display));
  }

  return lines;
}

// Strip ANSI codes for width measurement
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function padRight(s, width) {
  const visible = stripAnsi(s).length;
  const pad = Math.max(0, width - visible);
  return s + ' '.repeat(pad);
}

// --- main ---

const allTickets = loadAllTickets();
const filtered = applyFilters(allTickets);

// Group by status
const columns = [
  { key: 'open', label: 'OPEN', tickets: [] },
  { key: 'in_progress', label: 'IN PROGRESS', tickets: [] },
];
if (showClosed) {
  columns.push({ key: 'closed', label: 'CLOSED', tickets: [] });
}

for (const ticket of filtered) {
  const col = columns.find(c => c.key === ticket.status);
  if (col) col.tickets.push(ticket);
}

// Sort each column by priority (P0 first)
for (const col of columns) {
  col.tickets.sort((a, b) => a.priority - b.priority);
}

// Calculate column widths
const termWidth = process.stdout.columns || 80;
const numCols = columns.length;
const gap = 2;
const colWidth = Math.floor((termWidth - gap * (numCols - 1)) / numCols);

// Render headers
const separator = '\u2500'.repeat(colWidth);
const headerLine = columns.map(c => padRight(colors.bold(c.label), colWidth)).join(' '.repeat(gap));
const sepLine = columns.map(() => separator).join(' '.repeat(gap));

console.log(headerLine);
console.log(sepLine);

// Render cards - build card lines for each column, then interleave
const columnCards = columns.map(col => {
  const cardBlocks = [];
  for (const ticket of col.tickets) {
    const lines = renderCard(ticket, colWidth);
    cardBlocks.push(lines);
  }
  return cardBlocks;
});

// Find max number of cards across columns
const maxCards = Math.max(...columnCards.map(c => c.length), 0);

for (let cardIdx = 0; cardIdx < maxCards; cardIdx++) {
  // Find the max lines for this card row
  let maxLines = 0;
  for (const col of columnCards) {
    if (cardIdx < col.length) {
      maxLines = Math.max(maxLines, col[cardIdx].length);
    }
  }

  for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
    const row = columns.map((_, colIdx) => {
      const cards = columnCards[colIdx];
      if (cardIdx < cards.length && lineIdx < cards[cardIdx].length) {
        return padRight(cards[cardIdx][lineIdx], colWidth);
      }
      return ' '.repeat(colWidth);
    });
    console.log(row.join(' '.repeat(gap)));
  }

  // Blank line between cards
  if (cardIdx < maxCards - 1) {
    console.log('');
  }
}
