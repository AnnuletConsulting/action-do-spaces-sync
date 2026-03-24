import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rfc3339Timestamp, parseSpacesKeyOutput, buildSyncArgs } from '../helpers.js';

// ---------------------------------------------------------------------------
// rfc3339Timestamp
// ---------------------------------------------------------------------------
describe('rfc3339Timestamp', () => {
  it('returns a string matching the expected pattern', () => {
    const ts = rfc3339Timestamp();
    // Pattern: YYYY-MM-DDTHH-MM-SSZ
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  });

  it('produces a key name that starts with gha-do-sync-', () => {
    const keyName = `gha-do-sync-${rfc3339Timestamp()}`;
    assert.ok(keyName.startsWith('gha-do-sync-'));
    assert.ok(keyName.length > 'gha-do-sync-'.length);
  });

  it('contains no raw colons (shell-safe)', () => {
    assert.ok(!rfc3339Timestamp().includes(':'));
  });
});

// ---------------------------------------------------------------------------
// parseSpacesKeyOutput
// ---------------------------------------------------------------------------
describe('parseSpacesKeyOutput', () => {
  it('parses array response with access_key and secret_key', () => {
    const json = JSON.stringify([{ access_key: 'MYACCESSKEY', secret_key: 'MYSECRETKEY' }]);
    const { accessKey, secretKey } = parseSpacesKeyOutput(json);
    assert.equal(accessKey, 'MYACCESSKEY');
    assert.equal(secretKey, 'MYSECRETKEY');
  });

  it('parses object response with AccessKey and SecretKey', () => {
    const json = JSON.stringify({ AccessKey: 'AK', SecretKey: 'SK' });
    const { accessKey, secretKey } = parseSpacesKeyOutput(json);
    assert.equal(accessKey, 'AK');
    assert.equal(secretKey, 'SK');
  });

  it('parses access_key_id and secret_access_key aliases', () => {
    const json = JSON.stringify([{ access_key_id: 'AKI', secret_access_key: 'SAK' }]);
    const { accessKey, secretKey } = parseSpacesKeyOutput(json);
    assert.equal(accessKey, 'AKI');
    assert.equal(secretKey, 'SAK');
  });

  it('throws when access_key is missing', () => {
    const json = JSON.stringify([{ secret_key: 'SK' }]);
    assert.throws(() => parseSpacesKeyOutput(json), /Could not find access_key/);
  });

  it('throws when secret_key is missing', () => {
    const json = JSON.stringify([{ access_key: 'AK' }]);
    assert.throws(() => parseSpacesKeyOutput(json), /Could not find access_key/);
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseSpacesKeyOutput('not-json'), /Failed to parse/);
  });
});

// ---------------------------------------------------------------------------
// buildSyncArgs
// ---------------------------------------------------------------------------
describe('buildSyncArgs', () => {
  const base = { bucket: 'my-bucket', region: 'nyc3', spacesFolder: '', repoFolder: '.', isPublic: false, deleteFlag: false };

  it('builds minimal args without public or delete flags', () => {
    assert.deepEqual(buildSyncArgs(base), [
      's3', 'sync', '.', 's3://my-bucket',
      '--endpoint-url', 'https://nyc3.digitaloceanspaces.com',
    ]);
  });

  it('appends spacesFolder to bucket URI', () => {
    const args = buildSyncArgs({ ...base, spacesFolder: 'builds/prod' });
    assert.ok(args.includes('s3://my-bucket/builds/prod'));
  });

  it('strips leading slash from spacesFolder', () => {
    const args = buildSyncArgs({ ...base, spacesFolder: '/dist' });
    assert.ok(args.includes('s3://my-bucket/dist'));
  });

  it('includes --acl public-read when isPublic is true', () => {
    const args = buildSyncArgs({ ...base, isPublic: true });
    const aclIdx = args.indexOf('--acl');
    assert.notEqual(aclIdx, -1);
    assert.equal(args[aclIdx + 1], 'public-read');
  });

  it('includes --delete when deleteFlag is true', () => {
    const args = buildSyncArgs({ ...base, deleteFlag: true });
    assert.ok(args.includes('--delete'));
  });

  it('includes both --acl and --delete when both are true', () => {
    const args = buildSyncArgs({ ...base, isPublic: true, deleteFlag: true });
    assert.ok(args.includes('--acl'));
    assert.ok(args.includes('public-read'));
    assert.ok(args.includes('--delete'));
  });

  it('uses correct endpoint URL for each region', () => {
    for (const region of ['nyc3', 'sfo3', 'ams3', 'sgp1', 'fra1', 'syd1']) {
      const args = buildSyncArgs({ ...base, region });
      assert.ok(args.includes(`https://${region}.digitaloceanspaces.com`));
    }
  });
});

// ---------------------------------------------------------------------------
// Provided key bypass logic (pure logic — no exec or core needed)
// ---------------------------------------------------------------------------
describe('provided key bypass logic', () => {
  const usingProvidedKey = (ak, sk) => Boolean(ak && sk);

  it('is true when both access-key and secret-key are non-empty', () => {
    assert.equal(usingProvidedKey('AK', 'SK'), true);
  });

  it('is false when only access-key is provided', () => {
    assert.equal(usingProvidedKey('AK', ''), false);
  });

  it('is false when only secret-key is provided', () => {
    assert.equal(usingProvidedKey('', 'SK'), false);
  });

  it('is false when neither key is provided', () => {
    assert.equal(usingProvidedKey('', ''), false);
  });
});
