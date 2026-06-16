'use strict';
// Detached background worker: refresh the update-check cache, then exit naturally
// (no process.exit — the fetch uses connection: close so the event loop drains on
// its own). Spawned fire-and-forget by lib/update-check.js `refresh()`.

try { require('./update-check').refreshNow().catch(() => {}); } catch {}
