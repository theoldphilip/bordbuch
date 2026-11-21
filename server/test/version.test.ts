import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers.ts';
import { VERSION } from '../src/version.ts';

describe('version', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  before(async () => {
    ctx = await setup();
  });
  after(async () => ctx.cleanup());

  test('the VERSION file is the single source and looks like a release number', () => {
    const file = fs.readFileSync(path.resolve(import.meta.dirname, '../../VERSION'), 'utf8').trim();
    assert.match(file, /^\d+\.\d+\.\d+$/);
    assert.equal(VERSION, file);
    for (const pkg of ['../package.json', '../../web/package.json']) {
      assert.equal(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, pkg), 'utf8')).version, file, `${pkg} is in step with VERSION`);
    }
  });

  test('GET /api/version is public and reports version, build time and database state', async () => {
    const res = await ctx.call('GET', '/api/version');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, VERSION);
    assert.equal(res.body.builtAt, null, 'no build time when running from the repository');
    assert.equal(res.body.schema, 8, 'number of database migrations');
    assert.equal((await ctx.call('GET', '/api/health')).body.version, VERSION);
  });
});
