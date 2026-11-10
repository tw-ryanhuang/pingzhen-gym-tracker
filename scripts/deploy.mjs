import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const db = config.d1_databases?.find(item => item.binding === 'DB');
if (!db || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(db.database_id)) {
  console.error('Deployment stopped: set the existing pingzhen-gym D1 database ID in wrangler.jsonc. Do not create a replacement database.');
  process.exit(1);
}
if (config.name !== 'pingzhen-gym-tracker') throw new Error('Unexpected Worker name');
const result = spawnSync('npx', ['--no-install', 'wrangler', 'deploy'], { stdio: 'inherit', shell: false });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
