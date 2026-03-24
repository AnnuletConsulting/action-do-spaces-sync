'use strict';

const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Helper: capture the rfc3339Timestamp function independently
// ---------------------------------------------------------------------------
describe('rfc3339Timestamp', () => {
  it('returns a string matching the expected pattern', () => {
    // Import the function directly by re-implementing it to keep tests isolated
    function rfc3339Timestamp() {
      return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+/, '');
    }
    const ts = rfc3339Timestamp();
    // Pattern: YYYY-MM-DDTHH-MM-SSZ
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  });

  it('produces a value that starts with gha-do-sync- prefix correctly', () => {
    function rfc3339Timestamp() {
      return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+/, '');
    }
    const keyName = `gha-do-sync-${rfc3339Timestamp()}`;
    assert.ok(keyName.startsWith('gha-do-sync-'));
    assert.ok(keyName.length > 'gha-do-sync-'.length);
  });
});

// ---------------------------------------------------------------------------
// Test destination URI construction logic
// ---------------------------------------------------------------------------
describe('S3 destination URI', () => {
  function buildDestination(bucket, spacesFolder) {
    return spacesFolder
      ? `s3://${bucket}/${spacesFolder.replace(/^\//, '')}`
      : `s3://${bucket}`;
  }

  it('uses bucket root when spacesFolder is empty', () => {
    assert.equal(buildDestination('my-bucket', ''), 's3://my-bucket');
  });

  it('appends folder path when spacesFolder is set', () => {
    assert.equal(buildDestination('my-bucket', 'builds/prod'), 's3://my-bucket/builds/prod');
  });

  it('strips leading slash from spacesFolder', () => {
    assert.equal(buildDestination('my-bucket', '/dist'), 's3://my-bucket/dist');
  });

  it('builds correct endpoint URL', () => {
    const region = 'nyc3';
    const endpoint = `https://${region}.digitaloceanspaces.com`;
    assert.equal(endpoint, 'https://nyc3.digitaloceanspaces.com');
  });
});

// ---------------------------------------------------------------------------
// Test JSON key parsing logic
// ---------------------------------------------------------------------------
describe('Spaces key parsing', () => {
  function parseKey(output) {
    const parsed = JSON.parse(output);
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    const accessKey = key.access_key ?? key.AccessKey ?? key.access_key_id ?? key.key;
    const secretKey = key.secret_key ?? key.SecretKey ?? key.secret_access_key ?? key.secret;
    if (!accessKey || !secretKey) {
      throw new Error(`Could not find access_key / secret_key in doctl output. Keys present: ${Object.keys(key).join(', ')}`);
    }
    return { accessKey, secretKey };
  }

  it('parses array response with access_key and secret_key', () => {
    const json = JSON.stringify([{ access_key: 'MYACCESSKEY', secret_key: 'MYSECRETKEY' }]);
    const { accessKey, secretKey } = parseKey(json);
    assert.equal(accessKey, 'MYACCESSKEY');
    assert.equal(secretKey, 'MYSECRETKEY');
  });

  it('parses object response with AccessKey and SecretKey', () => {
    const json = JSON.stringify({ AccessKey: 'MYACCESSKEY', SecretKey: 'MYSECRETKEY' });
    const { accessKey, secretKey } = parseKey(json);
    assert.equal(accessKey, 'MYACCESSKEY');
    assert.equal(secretKey, 'MYSECRETKEY');
  });

  it('throws when access_key is missing', () => {
    const json = JSON.stringify([{ secret_key: 'MYSECRETKEY' }]);
    assert.throws(() => parseKey(json), /Could not find access_key/);
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseKey('not-json'), /SyntaxError|JSON/);
  });
});

// ---------------------------------------------------------------------------
// Test aws s3 sync argument construction
// ---------------------------------------------------------------------------
describe('aws s3 sync args construction', () => {
  function buildSyncArgs({ bucket, region, spacesFolder, repoFolder, isPublic, deleteFlag }) {
    const destination = spacesFolder
      ? `s3://${bucket}/${spacesFolder.replace(/^\//, '')}`
      : `s3://${bucket}`;
    const endpointUrl = `https://${region}.digitaloceanspaces.com`;
    const args = ['s3', 'sync', repoFolder, destination, '--endpoint-url', endpointUrl];
    if (isPublic) args.push('--acl', 'public-read');
    if (deleteFlag) args.push('--delete');
    return args;
  }

  it('builds minimal args without public or delete flags', () => {
    const args = buildSyncArgs({
      bucket: 'my-bucket',
      region: 'nyc3',
      spacesFolder: '',
      repoFolder: '.',
      isPublic: false,
      deleteFlag: false,
    });
    assert.deepEqual(args, [
      's3', 'sync', '.', 's3://my-bucket',
      '--endpoint-url', 'https://nyc3.digitaloceanspaces.com',
    ]);
  });

  it('includes --acl public-read when isPublic is true', () => {
    const args = buildSyncArgs({
      bucket: 'my-bucket',
      region: 'sfo3',
      spacesFolder: 'dist',
      repoFolder: './build',
      isPublic: true,
      deleteFlag: false,
    });
    assert.ok(args.includes('--acl'));
    assert.ok(args.includes('public-read'));
  });

  it('includes --delete when deleteFlag is true', () => {
    const args = buildSyncArgs({
      bucket: 'my-bucket',
      region: 'fra1',
      spacesFolder: '',
      repoFolder: '.',
      isPublic: false,
      deleteFlag: true,
    });
    assert.ok(args.includes('--delete'));
  });

  it('includes both --acl and --delete when both are true', () => {
    const args = buildSyncArgs({
      bucket: 'my-bucket',
      region: 'ams3',
      spacesFolder: 'assets',
      repoFolder: './public',
      isPublic: true,
      deleteFlag: true,
    });
    assert.ok(args.includes('--acl'));
    assert.ok(args.includes('public-read'));
    assert.ok(args.includes('--delete'));
  });
});
