#!/usr/bin/env node
// Empties the deploy folder (apps/client/dist/apex-ghost) before a build, keeping its Vercel project link (.vercel):
// the game builds into play/ and the website writes the rest, so nothing from an older layout is left behind.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist/apex-ghost');
if (existsSync(out)) for (const f of readdirSync(out)) if (f !== '.vercel') rmSync(path.join(out, f), { recursive: true, force: true });
