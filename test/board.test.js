const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'ticket-board.js');

function run(args = [], opts = {}) {
  return execFileSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
    cwd: opts.cwd,
  });
}

function makeTicket(ticketsDir, id, fields, title = 'Test ticket') {
  const fm = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const content = `---\nid: ${id}\n${fm}\n---\n# ${title}\n\nDescription.\n`;
  fs.writeFileSync(path.join(ticketsDir, `${id}.md`), content, 'utf8');
}

describe('ticket-board', () => {
  let tmp, ticketsDir;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-board-test-'));
    ticketsDir = path.join(tmp, '.tickets');
    fs.mkdirSync(ticketsDir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // --- meta ---

  describe('meta', () => {
    it('outputs tk-plugin description on --tk-describe', () => {
      const out = run(['--tk-describe']);
      assert.equal(out.trim(), 'tk-plugin: Kanban-style board view');
    });

    it('outputs help on --help', () => {
      const out = run(['--help']);
      assert.match(out, /Usage:/);
      assert.match(out, /--assignee/);
      assert.match(out, /--tag/);
      assert.match(out, /--no-closed/);
      assert.match(out, /--me/);
    });

    it('outputs help on -h', () => {
      const out = run(['-h']);
      assert.match(out, /Usage:/);
    });
  });

  // --- basic display ---

  describe('basic display', () => {
    it('shows empty board with no tickets', () => {
      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /OPEN/);
      assert.match(out, /IN PROGRESS/);
      assert.match(out, /CLOSED/);
    });

    it('shows tickets grouped by status', () => {
      makeTicket(ticketsDir, 'ab-1234', { status: 'open', priority: 2 }, 'Open ticket');
      makeTicket(ticketsDir, 'ab-5678', { status: 'in_progress', priority: 1 }, 'WIP ticket');
      makeTicket(ticketsDir, 'ab-9abc', { status: 'closed', priority: 3 }, 'Done ticket');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /OPEN/);
      assert.match(out, /IN PROGRESS/);
      assert.match(out, /CLOSED/);
      assert.match(out, /ab-1234/);
      assert.match(out, /Open ticket/);
      assert.match(out, /ab-5678/);
      assert.match(out, /WIP ticket/);
      assert.match(out, /ab-9abc/);
      assert.match(out, /Done ticket/);
    });

    it('sorts tickets by priority within columns', () => {
      makeTicket(ticketsDir, 'ab-low1', { status: 'open', priority: 4 }, 'Low prio');
      makeTicket(ticketsDir, 'ab-high', { status: 'open', priority: 0 }, 'High prio');
      makeTicket(ticketsDir, 'ab-med1', { status: 'open', priority: 2 }, 'Med prio');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      const highIdx = out.indexOf('ab-high');
      const medIdx = out.indexOf('ab-med1');
      const lowIdx = out.indexOf('ab-low1');
      assert.ok(highIdx < medIdx, 'P0 should appear before P2');
      assert.ok(medIdx < lowIdx, 'P2 should appear before P4');
    });
  });

  // --- filtering ---

  describe('filtering', () => {
    it('filters by assignee with -a', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, assignee: 'Alice' }, 'Alice task');
      makeTicket(ticketsDir, 'ab-2222', { status: 'open', priority: 2, assignee: 'Bob' }, 'Bob task');

      const out = run(['-a', 'Alice'], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /Alice task/);
      assert.doesNotMatch(out, /Bob task/);
    });

    it('filters by assignee with --assignee (case insensitive)', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, assignee: 'Alice' }, 'Alice task');
      makeTicket(ticketsDir, 'ab-2222', { status: 'open', priority: 2, assignee: 'Bob' }, 'Bob task');

      const out = run(['--assignee', 'alice'], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /Alice task/);
      assert.doesNotMatch(out, /Bob task/);
    });

    it('filters by tag with -T', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, tags: '[backend, api]' }, 'Backend task');
      makeTicket(ticketsDir, 'ab-2222', { status: 'open', priority: 2, tags: '[frontend]' }, 'Frontend task');

      const out = run(['-T', 'backend'], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /Backend task/);
      assert.doesNotMatch(out, /Frontend task/);
    });

    it('filters by tag case-insensitively', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, tags: '[Backend]' }, 'Backend task');

      const out = run(['-T', 'backend'], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /Backend task/);
    });

    it('--me filters to cwd folder name', () => {
      // Create a subfolder simulating user folder
      const userDir = path.join(tmp, 'alice');
      fs.mkdirSync(userDir);

      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, assignee: 'alice' }, 'Alice task');
      makeTicket(ticketsDir, 'ab-2222', { status: 'open', priority: 2, assignee: 'bob' }, 'Bob task');

      const out = run(['--me'], { env: { TICKETS_DIR: ticketsDir }, cwd: userDir });
      assert.match(out, /Alice task/);
      assert.doesNotMatch(out, /Bob task/);
    });
  });

  // --- --no-closed ---

  describe('--no-closed', () => {
    it('hides the closed column', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2 }, 'Open one');
      makeTicket(ticketsDir, 'ab-2222', { status: 'closed', priority: 2 }, 'Closed one');

      const out = run(['--no-closed'], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /OPEN/);
      assert.match(out, /IN PROGRESS/);
      assert.doesNotMatch(out, /CLOSED/);
      assert.match(out, /Open one/);
      assert.doesNotMatch(out, /Closed one/);
    });
  });

  // --- card rendering ---

  describe('card rendering', () => {
    it('shows assignee with @ prefix', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, assignee: 'ham' }, 'My task');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /@ham/);
    });

    it('shows tags with # prefix', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, tags: '[blocked, in_review]' }, 'My task');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /#blocked/);
      assert.match(out, /#in_review/);
    });

    it('shows PR URL (truncated if needed)', () => {
      makeTicket(ticketsDir, 'ab-1111', {
        status: 'in_progress',
        priority: 0,
        'pull_request': 'https://github.com/org/repo/pull/12',
      }, 'Fix auth');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      // URL appears, possibly truncated with ellipsis
      assert.match(out, /https:\/\/github\.com\/org\//);
    });

    it('shows short PR URL in full without truncation', () => {
      makeTicket(ticketsDir, 'ab-1111', {
        status: 'in_progress',
        priority: 0,
        'pull_request': 'https://gh.io/pr/1',
      }, 'Fix auth');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /https:\/\/gh\.io\/pr\/1/);
    });

    it('shows priority labels', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 0 }, 'Critical');
      makeTicket(ticketsDir, 'ab-2222', { status: 'open', priority: 2 }, 'Medium');
      makeTicket(ticketsDir, 'ab-3333', { status: 'open', priority: 4 }, 'Backlog');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /P0/);
      assert.match(out, /P2/);
      assert.match(out, /P4/);
    });
  });

  // --- directory ascending ---

  describe('directory ascending', () => {
    it('finds .tickets from a subdirectory', () => {
      makeTicket(ticketsDir, 'ab-1234', { status: 'open', priority: 2 }, 'Found it');

      const sub = path.join(tmp, 'deep', 'nested');
      fs.mkdirSync(sub, { recursive: true });

      // No TICKETS_DIR env, relies on walking up
      const env = { ...process.env };
      delete env.TICKETS_DIR;
      const out = execFileSync(process.execPath, [BIN], {
        env,
        encoding: 'utf8',
        cwd: sub,
      });
      assert.match(out, /ab-1234/);
      assert.match(out, /Found it/);
    });
  });

  // --- error cases ---

  describe('error cases', () => {
    it('exits with error for unknown option', () => {
      assert.throws(() => {
        run(['--bogus'], { env: { TICKETS_DIR: ticketsDir } });
      }, /Unknown option/);
    });

    it('exits with error when no .tickets dir found', () => {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-notickets-'));
      try {
        const env = { ...process.env };
        delete env.TICKETS_DIR;
        assert.throws(() => {
          execFileSync(process.execPath, [BIN], {
            env,
            encoding: 'utf8',
            cwd: isolated,
          });
        }, /no .tickets directory/);
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    });
  });

  // --- default priority ---

  describe('defaults', () => {
    it('defaults priority to 2 when not specified', () => {
      const content = `---\nid: ab-nop\nstatus: open\n---\n# No priority\n`;
      fs.writeFileSync(path.join(ticketsDir, 'ab-nop.md'), content, 'utf8');

      const out = run([], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /ab-nop/);
      assert.match(out, /P2/);
    });
  });

  // --- combined filters ---

  describe('combined filters', () => {
    it('applies both assignee and tag filters', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 2, assignee: 'Alice', tags: '[backend]' }, 'Match');
      makeTicket(ticketsDir, 'ab-2222', { status: 'open', priority: 2, assignee: 'Alice', tags: '[frontend]' }, 'Wrong tag');
      makeTicket(ticketsDir, 'ab-3333', { status: 'open', priority: 2, assignee: 'Bob', tags: '[backend]' }, 'Wrong person');

      const out = run(['-a', 'Alice', '-T', 'backend'], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /Match/);
      assert.doesNotMatch(out, /Wrong tag/);
      assert.doesNotMatch(out, /Wrong person/);
    });
  });

  // --- color control ---

  describe('color control', () => {
    it('--color=always outputs ANSI codes even when piped', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 0 }, 'Critical');

      const out = run(['--color=always'], { env: { TICKETS_DIR: ticketsDir } });
      assert.match(out, /\x1b\[/, 'should contain ANSI escape codes');
    });

    it('--color=never suppresses ANSI codes', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 0 }, 'Critical');

      const out = run(['--color=never'], { env: { TICKETS_DIR: ticketsDir } });
      assert.doesNotMatch(out, /\x1b\[/, 'should not contain ANSI escape codes');
    });

    it('FORCE_COLOR=1 enables colors when piped', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 0 }, 'Critical');

      const out = run([], { env: { TICKETS_DIR: ticketsDir, FORCE_COLOR: '1' } });
      assert.match(out, /\x1b\[/, 'should contain ANSI escape codes');
    });

    it('NO_COLOR disables colors', () => {
      makeTicket(ticketsDir, 'ab-1111', { status: 'open', priority: 0 }, 'Critical');

      const out = run([], { env: { TICKETS_DIR: ticketsDir, NO_COLOR: '' } });
      assert.doesNotMatch(out, /\x1b\[/, 'should not contain ANSI escape codes');
    });
  });
});
