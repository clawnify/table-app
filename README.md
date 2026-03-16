# OpenClaw Table App: The Open-Source Clay Alternative for SaaS

A flexible, multi-table data UI for building SaaS dashboards, CRM tools, and spreadsheet-like apps. Part of the [OpenClaw](https://github.com/openclaw/openclaw) ecosystem. Zero cloud dependencies — runs locally with SQLite.

Built with **Preact + Hono + SQLite**. Ships with a dual-mode UI: one for humans (click-to-edit, drag-to-reorder) and one for AI agents (explicit buttons, large targets).

## What Is It?

Clawnify Table App is a production-ready table UI framework designed for the OpenClaw community. Think of it as an open-source Clay alternative — a data table you can self-host, customize, and embed in any SaaS product.

Unlike Clay or Airtable, this runs entirely on your own infrastructure with no API keys, no vendor lock-in, and no per-seat pricing. Create multiple tables, define custom columns, sort/filter/paginate, and export to CSV — all out of the box.

## Features

- **Multiple tables** — create, rename, delete tables with a tab-based UI
- **Dynamic columns** — add, rename, reorder (drag), change type (text/number), delete
- **Inline editing** — click any cell to edit (human mode) or use explicit forms (agent mode)
- **Sorting & filtering** — per-column with debounced search
- **Pagination** — configurable page size (25/50/100)
- **CSV export** — one-click export with dynamic column names
- **JSON data store** — row data stored as JSON, no schema migrations needed
- **Dual-mode UI** — human-optimized + AI-agent-optimized (`?agent=true`)
- **SQLite persistence** — auto-creates schema and seeds a default table on first run

## Quickstart

```bash
git clone https://github.com/clawnify/table-app.git
cd table-app
pnpm install
pnpm run dev
```

Open `http://localhost:5174` in your browser. Data persists in `data.db`.

### Agent Mode (for OpenClaw / Browser-Use)

Append `?agent=true` to the URL:

```
http://localhost:5174/?agent=true
```

This activates an agent-friendly UI with:
- Explicit "Edit" / "Rename" / "Delete" buttons (no hover or double-click interactions)
- Larger click targets for reliable browser automation
- Column management buttons directly in the table header
- Table management buttons in the tab bar

The human UI stays unchanged — click cells to edit, drag columns to reorder, right-click for context menus.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Preact, TypeScript, Vite |
| **Backend** | Hono, Node.js |
| **Database** | SQLite (better-sqlite3) |
| **Icons** | Lucide |

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)

## Architecture

```
src/
  server/
    schema.sql  — SQLite schema (_tables, _columns, _rows)
    db.ts       — SQLite wrapper + seed logic
    index.ts    — Hono REST API (tables, columns, rows, CSV export)
  client/
    app.tsx           — Root component + agent mode detection
    context.tsx       — Preact context for table state
    hooks/use-table.ts — Multi-table state management
    components/
      table-tabs.tsx    — Tab navigation for multiple tables
      table-header.tsx  — Dynamic column headers (sort, rename, drag, add)
      table-row.tsx     — Dynamic row rendering + inline edit
      add-row-form.tsx  — New row form from dynamic columns
      data-table.tsx    — Main table container
      toolbar.tsx       — Table name + action buttons
      pagination.tsx    — Page controls
```

### Data Model

Tables use a JSON data store pattern — row data is stored as `JSON` objects keyed by column ID. This means column operations (add, rename, reorder, delete) only touch metadata, never requiring `ALTER TABLE`:

```sql
_tables  (id, name, position)
_columns (id, table_id, name, type, position)
_rows    (id, table_id, data JSON, created_at, updated_at)
```

## How Clawnify Uses This

[Clawnify](https://clawnify.com) uses this template as a starting point when AI agents request a data table app via the App Builder. The `db.ts` file is swapped with a Cloudflare D1 adapter, the code is bundled, and deployed to Workers for Platforms. The rest of the app stays identical.

## Community & Contributions

This project is part of the [OpenClaw](https://github.com/openclaw/openclaw) ecosystem. Contributions are welcome — open an issue or submit a PR.

## License

MIT
