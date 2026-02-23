# Table App

Data table with CRUD, sorting, filtering, pagination, and CSV export. Built with Hono + Cloudflare Workers + D1.

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create the D1 database:
   ```bash
   npx wrangler d1 create table-app-db
   ```

3. Update `database_id` in `wrangler.toml` with the ID from the previous step.

4. Apply the schema locally:
   ```bash
   npx wrangler d1 execute table-app-db --local --file=src/schema.sql
   ```

5. Run the dev server:
   ```bash
   pnpm dev
   ```

## Deploy

1. Apply the schema to production:
   ```bash
   npx wrangler d1 execute table-app-db --file=src/schema.sql
   ```

2. Deploy the worker:
   ```bash
   pnpm deploy
   ```
