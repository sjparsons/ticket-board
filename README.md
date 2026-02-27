# tk board

A `tk` plugin that displays tickets in a kanban-style board view.

```
tk board [options]
```

```
 OPEN                     IN PROGRESS               CLOSED
 ─────────────────────    ─────────────────────      ─────────────────────
 mcp-x2j4  P2             mcp-c8b1  P0               mcp-yh43  P2
 create admin-ui          fix auth flow              setup CI pipeline
 @ham                     @ewe  #blocked             @jig  #in_review
                          PR: gh/org/repo#12

 mcp-a3f1  P3
 write unit tests
 @box
```

Cards show ID, priority, title, assignee, tags, and clickable PR links. Sorted by priority (P0 first). Columns sized to terminal width.

## Options

| Flag | Description |
|------|-------------|
| `-a, --assignee NAME` | Filter to a single assignee |
| `-T, --tag TAG` | Filter to tickets with a specific tag |
| `--no-closed` | Hide the closed column |
| `--me` | Filter to current worker (inferred from cwd folder name) |
| `--color=MODE` | Color output: `always`, `never`, `auto` (default: `auto`) |

Also respects `FORCE_COLOR=1` and `NO_COLOR` env vars.

### Live dashboard

```
watch -n 5 --color 'tk board --color=always'
```

## Install

```
npm install -g <path to this github repo>
tk board
```
