import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { initDB, query, get, run } from "./db.js";

type Env = { Bindings: { DB: D1Database } };

const app = new OpenAPIHono<Env>();

app.use("*", async (c, next) => {
  initDB(c.env.DB);
  await next();
});

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const TableSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  column_count: z.number().int().optional(),
  row_count: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Table");

const ColumnSchema = z.object({
  id: z.string(),
  table_id: z.string(),
  name: z.string(),
  type: z.enum(["text", "number"]),
  position: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Column");

const RowSchema = z.object({
  id: z.number().int(),
  table_id: z.string(),
  data: z.record(z.string(), z.unknown()).describe("Column ID → value pairs"),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Row");

// ── Shared Params ──────────────────────────────────────────────────

const IdParam = z.object({ id: z.string().openapi({ description: "Resource ID (UUID)" }) });
const TidParam = z.object({ tid: z.string().openapi({ description: "Table ID (UUID)" }) });
const TidIdParam = z.object({
  tid: z.string().openapi({ description: "Table ID (UUID)" }),
  id: z.string().openapi({ description: "Resource ID" }),
});
const TidRowIdParam = z.object({
  tid: z.string().openapi({ description: "Table ID (UUID)" }),
  id: z.string().openapi({ description: "Row ID (integer)" }),
});

// ── Tables ─────────────────────────────────────────────────────────

const listTables = createRoute({
  method: "get",
  path: "/api/tables",
  tags: ["Tables"],
  summary: "List all tables with column and row counts",
  responses: {
    200: { description: "Array of tables", content: { "application/json": { schema: z.object({ tables: z.array(TableSchema) }) } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listTables, async (c) => {
  try {
    const tables = await query(
      `SELECT t.*, (SELECT COUNT(*) FROM _columns WHERE table_id = t.id) as column_count,
              (SELECT COUNT(*) FROM _rows WHERE table_id = t.id) as row_count
       FROM _tables t ORDER BY t.position, t.created_at`,
    );
    return c.json({ tables }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createTable = createRoute({
  method: "post",
  path: "/api/tables",
  tags: ["Tables"],
  summary: "Create a new table",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1),
            columns: z.array(z.object({
              name: z.string().optional(),
              type: z.enum(["text", "number"]).optional(),
            })).optional().describe("Optional initial columns. Defaults to one 'Name' text column."),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created table", content: { "application/json": { schema: z.object({ table: TableSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createTable, async (c) => {
  try {
    const body = c.req.valid("json");
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name is required" }, 400);

    const maxPos = await get<{ mp: number }>("SELECT COALESCE(MAX(position), -1) as mp FROM _tables");
    const tableId = crypto.randomUUID();

    await run("INSERT INTO _tables (id, name, position) VALUES (?, ?, ?)", [tableId, name, (maxPos?.mp ?? -1) + 1]);

    const columns = body.columns;
    if (columns && columns.length > 0) {
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const colName = (col.name || "").trim() || `Column ${i + 1}`;
        const colType = col.type === "number" ? "number" : "text";
        await run(
          "INSERT INTO _columns (id, table_id, name, type, position) VALUES (?, ?, ?, ?, ?)",
          [crypto.randomUUID(), tableId, colName, colType, i],
        );
      }
    } else {
      await run(
        "INSERT INTO _columns (id, table_id, name, type, position) VALUES (?, ?, ?, ?, ?)",
        [crypto.randomUUID(), tableId, "Name", "text", 0],
      );
    }

    const table = await get("SELECT * FROM _tables WHERE id = ?", [tableId]);
    return c.json({ table }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const renameTable = createRoute({
  method: "put",
  path: "/api/tables/{id}",
  tags: ["Tables"],
  summary: "Rename a table",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ name: z.string().min(1) }) } },
    },
  },
  responses: {
    200: { description: "Updated table", content: { "application/json": { schema: z.object({ table: TableSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(renameTable, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const { name } = c.req.valid("json");
    const trimmed = name.trim();
    if (!trimmed) return c.json({ error: "Name is required" }, 400);

    const result = await run("UPDATE _tables SET name = ?, updated_at = datetime('now') WHERE id = ?", [trimmed, id]);
    if (result.changes === 0) return c.json({ error: "Table not found" }, 404);

    const table = await get("SELECT * FROM _tables WHERE id = ?", [id]);
    return c.json({ table }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteTable = createRoute({
  method: "delete",
  path: "/api/tables/{id}",
  tags: ["Tables"],
  summary: "Delete a table and all its columns/rows",
  request: { params: IdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteTable, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const result = await run("DELETE FROM _tables WHERE id = ?", [id]);
    if (result.changes === 0) return c.json({ error: "Table not found" }, 404);
    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Columns ────────────────────────────────────────────────────────

const listColumns = createRoute({
  method: "get",
  path: "/api/tables/{tid}/columns",
  tags: ["Columns"],
  summary: "List columns for a table",
  request: { params: TidParam },
  responses: {
    200: { description: "Array of columns", content: { "application/json": { schema: z.object({ columns: z.array(ColumnSchema) }) } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listColumns, async (c) => {
  try {
    const { tid } = c.req.valid("param");
    const columns = await query("SELECT * FROM _columns WHERE table_id = ? ORDER BY position", [tid]);
    return c.json({ columns }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const addColumn = createRoute({
  method: "post",
  path: "/api/tables/{tid}/columns",
  tags: ["Columns"],
  summary: "Add a column to a table",
  request: {
    params: TidParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().optional(),
            type: z.enum(["text", "number"]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created column", content: { "application/json": { schema: z.object({ column: ColumnSchema }) } } },
    404: { description: "Table not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addColumn, async (c) => {
  try {
    const { tid } = c.req.valid("param");
    const table = await get("SELECT id FROM _tables WHERE id = ?", [tid]);
    if (!table) return c.json({ error: "Table not found" }, 404);

    const body = c.req.valid("json");
    const name = (body.name || "").trim() || "New Column";
    const type = body.type === "number" ? "number" : "text";

    const maxPos = await get<{ mp: number }>(
      "SELECT COALESCE(MAX(position), -1) as mp FROM _columns WHERE table_id = ?", [tid],
    );
    const colId = crypto.randomUUID();
    await run(
      "INSERT INTO _columns (id, table_id, name, type, position) VALUES (?, ?, ?, ?, ?)",
      [colId, tid, name, type, (maxPos?.mp ?? -1) + 1],
    );

    const col = await get("SELECT * FROM _columns WHERE id = ?", [colId]);
    return c.json({ column: col }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateColumn = createRoute({
  method: "put",
  path: "/api/tables/{tid}/columns/{id}",
  tags: ["Columns"],
  summary: "Update a column name or type",
  request: {
    params: TidIdParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().optional(),
            type: z.enum(["text", "number"]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated column", content: { "application/json": { schema: z.object({ column: ColumnSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateColumn, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const setClauses: string[] = [];
    const setParams: unknown[] = [];

    if (body.name !== undefined) {
      const name = (body.name || "").trim();
      if (!name) return c.json({ error: "Name is required" }, 400);
      setClauses.push("name = ?");
      setParams.push(name);
    }
    if (body.type !== undefined) {
      setClauses.push("type = ?");
      setParams.push(body.type === "number" ? "number" : "text");
    }

    if (setClauses.length === 0) return c.json({ error: "No fields to update" }, 400);

    setClauses.push("updated_at = datetime('now')");
    setParams.push(id);

    const result = await run("UPDATE _columns SET " + setClauses.join(", ") + " WHERE id = ?", setParams);
    if (result.changes === 0) return c.json({ error: "Column not found" }, 404);

    const col = await get("SELECT * FROM _columns WHERE id = ?", [id]);
    return c.json({ column: col }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteColumn = createRoute({
  method: "delete",
  path: "/api/tables/{tid}/columns/{id}",
  tags: ["Columns"],
  summary: "Delete a column and remove its data from all rows",
  request: { params: TidIdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteColumn, async (c) => {
  try {
    const { tid, id } = c.req.valid("param");

    const col = await get<{ id: string }>("SELECT id FROM _columns WHERE id = ? AND table_id = ?", [id, tid]);
    if (!col) return c.json({ error: "Column not found" }, 404);

    await run("DELETE FROM _columns WHERE id = ?", [id]);
    const rows = await query<{ id: number; data: string }>("SELECT id, data FROM _rows WHERE table_id = ?", [tid]);
    for (const row of rows) {
      const data = JSON.parse(row.data);
      delete data[id];
      await run("UPDATE _rows SET data = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(data), row.id]);
    }

    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const reorderColumns = createRoute({
  method: "put",
  path: "/api/tables/{tid}/columns/reorder",
  tags: ["Columns"],
  summary: "Reorder columns",
  request: {
    params: TidParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            ids: z.array(z.string()).describe("Column IDs in desired order"),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Reordered columns", content: { "application/json": { schema: z.object({ columns: z.array(ColumnSchema) }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(reorderColumns, async (c) => {
  try {
    const { tid } = c.req.valid("param");
    const { ids } = c.req.valid("json");

    for (let i = 0; i < ids.length; i++) {
      await run("UPDATE _columns SET position = ?, updated_at = datetime('now') WHERE id = ? AND table_id = ?", [i, ids[i], tid]);
    }

    const columns = await query("SELECT * FROM _columns WHERE table_id = ? ORDER BY position", [tid]);
    return c.json({ columns }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Rows ───────────────────────────────────────────────────────────

const listRows = createRoute({
  method: "get",
  path: "/api/tables/{tid}/rows",
  tags: ["Rows"],
  summary: "List rows with pagination, sorting, and filtering",
  request: {
    params: TidParam,
    query: z.object({
      page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
      limit: z.string().optional().openapi({ description: "Items per page (default: 25, max: 100)" }),
      sort: z.string().optional().openapi({ description: "Column ID or 'id'/'created_at'/'updated_at'" }),
      order: z.enum(["asc", "desc"]).optional().openapi({ description: "Sort direction (default: desc)" }),
    }),
  },
  responses: {
    200: {
      description: "Paginated rows",
      content: {
        "application/json": {
          schema: z.object({
            rows: z.array(RowSchema),
            total: z.number().int(),
            page: z.number().int(),
            limit: z.number().int(),
          }),
        },
      },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listRows, async (c) => {
  try {
    const { tid } = c.req.valid("param");
    const q = c.req.valid("query");
    const page = Math.max(1, parseInt(q.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || "25", 10)));
    const offset = (page - 1) * limit;

    const sortCol = q.sort || "id";
    let order: string = (q.order || "desc").toLowerCase();
    if (order !== "asc" && order !== "desc") order = "desc";

    // Build WHERE clause
    const whereClauses: string[] = ["table_id = ?"];
    const whereParams: unknown[] = [tid];

    // Filters on JSON data columns (filter_<column_id>=value)
    const url = new URL(c.req.url);
    for (const [key, val] of url.searchParams.entries()) {
      if (key.startsWith("filter_") && val.trim()) {
        const colId = key.slice(7);
        if (colId === "id") {
          whereClauses.push("CAST(id AS TEXT) LIKE ?");
          whereParams.push("%" + val.trim() + "%");
        } else if (/^[0-9a-f-]{36}$/i.test(colId)) {
          whereClauses.push("json_extract(data, '$.' || ?) LIKE ?");
          whereParams.push(colId, "%" + val.trim() + "%");
        }
      }
    }

    const whereSQL = " WHERE " + whereClauses.join(" AND ");

    const countResult = await get<{ total: number }>(
      "SELECT COUNT(*) as total FROM _rows" + whereSQL,
      [...whereParams],
    );
    const total = countResult?.total || 0;

    let orderSQL: string;
    const queryParams = [...whereParams];
    if (sortCol === "id" || sortCol === "created_at" || sortCol === "updated_at") {
      orderSQL = ` ORDER BY ${sortCol} ${order}`;
    } else if (/^[0-9a-f-]{36}$/i.test(sortCol)) {
      orderSQL = ` ORDER BY json_extract(data, '$.' || ?) ${order}`;
      queryParams.push(sortCol);
    } else {
      orderSQL = ` ORDER BY id ${order}`;
    }

    queryParams.push(limit, offset);

    const rows = await query(
      "SELECT * FROM _rows" + whereSQL + orderSQL + " LIMIT ? OFFSET ?",
      queryParams,
    );

    const parsed = (rows as { id: number; table_id: string; data: string; created_at: string; updated_at: string }[]).map((r) => ({
      id: r.id,
      table_id: r.table_id,
      data: JSON.parse(r.data),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return c.json({ rows: parsed, total, page, limit }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createRow = createRoute({
  method: "post",
  path: "/api/tables/{tid}/rows",
  tags: ["Rows"],
  summary: "Create a new row",
  request: {
    params: TidParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            data: z.record(z.string(), z.unknown()).optional().describe("Key-value pairs where keys are column IDs"),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created row", content: { "application/json": { schema: z.object({ row: RowSchema }) } } },
    404: { description: "Table not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createRow, async (c) => {
  try {
    const { tid } = c.req.valid("param");
    const table = await get("SELECT id FROM _tables WHERE id = ?", [tid]);
    if (!table) return c.json({ error: "Table not found" }, 404);

    const body = c.req.valid("json");
    const data = body.data || {};

    const result = await run(
      "INSERT INTO _rows (table_id, data) VALUES (?, ?)",
      [tid, JSON.stringify(data)],
    );

    const inserted = await get("SELECT * FROM _rows WHERE id = ?", [result.lastInsertRowid]) as {
      id: number; table_id: string; data: string; created_at: string; updated_at: string;
    };

    return c.json({
      row: { ...inserted, data: JSON.parse(inserted.data) },
    }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateRow = createRoute({
  method: "put",
  path: "/api/tables/{tid}/rows/{id}",
  tags: ["Rows"],
  summary: "Update a row (merges data)",
  request: {
    params: TidRowIdParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            data: z.record(z.string(), z.unknown()).describe("Key-value pairs to merge into existing data"),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated row", content: { "application/json": { schema: z.object({ row: RowSchema }) } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateRow, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const rowId = parseInt(id, 10);
    if (isNaN(rowId)) return c.json({ error: "Invalid ID" }, 400);

    const existing = await get<{ data: string }>("SELECT data FROM _rows WHERE id = ?", [rowId]);
    if (!existing) return c.json({ error: "Row not found" }, 404);

    const body = c.req.valid("json");
    const newData = { ...JSON.parse(existing.data), ...body.data };

    await run(
      "UPDATE _rows SET data = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(newData), rowId],
    );

    const updated = await get("SELECT * FROM _rows WHERE id = ?", [rowId]) as {
      id: number; table_id: string; data: string; created_at: string; updated_at: string;
    };
    return c.json({ row: { ...updated, data: JSON.parse(updated.data) } }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteRow = createRoute({
  method: "delete",
  path: "/api/tables/{tid}/rows/{id}",
  tags: ["Rows"],
  summary: "Delete a row",
  request: { params: TidRowIdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteRow, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const rowId = parseInt(id, 10);
    if (isNaN(rowId)) return c.json({ error: "Invalid ID" }, 400);

    const result = await run("DELETE FROM _rows WHERE id = ?", [rowId]);
    if (result.changes === 0) return c.json({ error: "Row not found" }, 404);

    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── CSV Export ─────────────────────────────────────────────────────

const exportCsv = createRoute({
  method: "get",
  path: "/api/tables/{tid}/export/csv",
  tags: ["Export"],
  summary: "Export table rows as CSV",
  request: { params: TidParam },
  responses: {
    200: { description: "CSV file download", content: { "text/csv": { schema: z.string() } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(exportCsv, async (c) => {
  try {
    const { tid } = c.req.valid("param");
    const columns = await query<{ id: string; name: string }>(
      "SELECT id, name FROM _columns WHERE table_id = ? ORDER BY position", [tid],
    );
    const rows = await query<{ id: number; data: string; created_at: string; updated_at: string }>(
      "SELECT * FROM _rows WHERE table_id = ? ORDER BY id DESC", [tid],
    );

    const headers = ["id", ...columns.map((col) => col.name), "created_at", "updated_at"];

    const escapeCsv = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    };

    let csv = headers.map(escapeCsv).join(",") + "\n";
    for (const row of rows) {
      const data = JSON.parse(row.data);
      const values = [
        String(row.id),
        ...columns.map((col) => String(data[col.id] ?? "")),
        row.created_at,
        row.updated_at,
      ];
      csv += values.map(escapeCsv).join(",") + "\n";
    }

    const tableName = await get<{ name: string }>("SELECT name FROM _tables WHERE id = ?", [tid]);
    const filename = (tableName?.name || "export").replace(/[^a-zA-Z0-9-_]/g, "_");

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename=${filename}-export.csv`);
    return c.body(csv);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── OpenAPI Doc ────────────────────────────────────────────────────

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "Table App", version: "1.0.0", description: "A dynamic table management API with CRUD operations for tables, columns, and rows." },
});

export default app;
