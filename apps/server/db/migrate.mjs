#!/usr/bin/env node
/**
 * Applies schema.sql to the accounts database. The URL comes from DATABASE_URL, or from apps/server/.dev.vars
 * (gitignored) for the local server.
 *
 *   node apps/server/db/migrate.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const vars = path.join(here, '..', '.dev.vars');
const url =
  process.env.DATABASE_URL ??
  (existsSync(vars)
    ? readFileSync(vars, 'utf8')
        .match(/^DATABASE_URL=(.*)$/m)?.[1]
        ?.trim()
    : undefined);
if (!url) throw new Error('DATABASE_URL is not set (env or apps/server/.dev.vars)');
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
await sql.unsafe(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
const t = await sql`select table_name from information_schema.tables where table_schema = 'apex' order by 1`;
console.log('apex schema:', t.map((r) => r.table_name).join(', '));
await sql.end();
