'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');

/**
 * Returns an RFC-3339 timestamp string safe for use in a key name.
 * Colons are replaced with hyphens so the value is shell-safe.
 * Example: 2024-01-15T10-30-45Z
 *
 * @returns {string}
 */
function rfc3339Timestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+/, '');
}

/**
 * Runs a command and captures its stdout, throwing on non-zero exit.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('@actions/exec').ExecOptions} [options]
 * @returns {Promise<string>} stdout
 */
async function captureOutput(cmd, args, options = {}) {
  let stdout = '';
  let stderr = '';
  const exitCode = await exec.exec(cmd, args, {
    ...options,
    listeners: {
      stdout: (data) => { stdout += data.toString(); },
      stderr: (data) => { stderr += data.toString(); },
    },
    ignoreReturnCode: true,
  });
  if (exitCode !== 0) {
    throw new Error(`Command '${cmd} ${args.join(' ')}' failed with exit code ${exitCode}.\n${stderr}`);
  }
  return stdout;
}

/**
 * Verifies that doctl is installed and the current context is authenticated.
 * Throws a descriptive error if either check fails.
 */
async function verifyDoctl() {
  // Check doctl binary exists
  try {
    await captureOutput('doctl', ['version']);
  } catch {
    throw new Error(
      'doctl is not installed or not found in PATH. ' +
      'Please add the digitalocean/action-doctl step before this action.',
    );
  }

  // Check authentication by listing contexts; doctl exits non-zero when unauthenticated
  try {
    await captureOutput('doctl', ['auth', 'list']);
  } catch {
    throw new Error(
      'doctl is not authenticated. ' +
      'Please run digitalocean/action-doctl with a valid DIGITALOCEAN_ACCESS_TOKEN before this action.',
    );
  }
}

/**
 * Creates a temporary DigitalOcean Spaces key with read-write permission
 * scoped to the given bucket.
 *
 * @param {string} keyName  The key name to create.
 * @param {string} bucket   The Spaces bucket name.
 * @returns {Promise<{accessKey: string, secretKey: string}>}
 */
async function createSpacesKey(keyName, bucket) {
  core.info(`Creating temporary Spaces key: ${keyName}`);

  const output = await captureOutput('doctl', [
    'spaces', 'keys', 'create', keyName,
    '--grants', `bucket=${bucket};permission=readwrite`,
    '--output', 'json',
    '--no-header',
  ]);

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`Failed to parse doctl spaces keys create output as JSON:\n${output}`);
  }

  // doctl returns an array; take the first element
  const key = Array.isArray(parsed) ? parsed[0] : parsed;

  const accessKey = key.access_key ?? key.AccessKey ?? key.access_key_id ?? key.key;
  const secretKey = key.secret_key ?? key.SecretKey ?? key.secret_access_key ?? key.secret;

  if (!accessKey || !secretKey) {
    throw new Error(
      `Could not find access_key / secret_key in doctl output. ` +
      `Keys present: ${Object.keys(key).join(', ')}`,
    );
  }

  return { accessKey, secretKey };
}

/**
 * Deletes a DigitalOcean Spaces key by its access key ID.
 *
 * @param {string} accessKey
 */
async function deleteSpacesKey(accessKey) {
  core.info(`Deleting temporary Spaces key: ${accessKey}`);
  try {
    await captureOutput('doctl', [
      'spaces', 'keys', 'delete', accessKey,
      '--force',
    ]);
    core.info('Temporary Spaces key deleted successfully.');
  } catch (err) {
    // Log but do not re-throw; cleanup should not mask the original error.
    core.warning(`Failed to delete temporary Spaces key '${accessKey}': ${err.message}`);
  }
}

/**
 * Runs aws s3 sync using the provided credentials and parameters.
 *
 * @param {object} params
 * @param {string} params.accessKey
 * @param {string} params.secretKey
 * @param {string} params.bucket
 * @param {string} params.region
 * @param {string} params.spacesFolder
 * @param {string} params.repoFolder
 * @param {boolean} params.isPublic
 * @param {boolean} params.deleteFlag
 */
async function runS3Sync({ accessKey, secretKey, bucket, region, spacesFolder, repoFolder, isPublic, deleteFlag }) {
  // Build the S3 destination URI
  const destination = spacesFolder
    ? `s3://${bucket}/${spacesFolder.replace(/^\//, '')}`
    : `s3://${bucket}`;

  const endpointUrl = `https://${region}.digitaloceanspaces.com`;

  const args = [
    's3', 'sync',
    repoFolder,
    destination,
    '--endpoint-url', endpointUrl,
  ];

  if (isPublic) {
    args.push('--acl', 'public-read');
  }

  if (deleteFlag) {
    args.push('--delete');
  }

  core.info(`Running: aws ${args.join(' ')}`);

  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_DEFAULT_REGION: region,
  };

  const exitCode = await exec.exec('aws', args, {
    env,
    ignoreReturnCode: true,
  });

  if (exitCode !== 0) {
    throw new Error(`aws s3 sync failed with exit code ${exitCode}.`);
  }
}

async function run() {
  // Read inputs
  const bucket = core.getInput('spaces-bucket', { required: true });
  const region = core.getInput('spaces-region', { required: true });
  const spacesFolder = core.getInput('spaces-folder') || '';
  const isPublic = core.getBooleanInput('is-public');
  const repoFolder = core.getInput('repo-folder') || '.';
  const deleteFlag = core.getBooleanInput('delete');

  // Step 1: Verify doctl
  await verifyDoctl();

  // Step 2: Build a unique key name using an RFC-3339 timestamp
  const keyName = `gha-do-sync-${rfc3339Timestamp()}`;

  // Step 3: Create the temporary Spaces key
  const { accessKey, secretKey } = await createSpacesKey(keyName, bucket);

  // Mask the secret key so it never appears in logs
  core.setSecret(secretKey);
  core.setSecret(accessKey);

  // Step 4: Sync — always clean up the key regardless of outcome
  let syncError = null;
  try {
    await runS3Sync({ accessKey, secretKey, bucket, region, spacesFolder, repoFolder, isPublic, deleteFlag });
  } catch (err) {
    syncError = err;
  } finally {
    // Step 5: Delete the temporary key (runs even if sync failed)
    await deleteSpacesKey(accessKey);
  }

  if (syncError) {
    core.setFailed(syncError.message);
  }
}

run().catch((err) => {
  core.setFailed(err.message);
});
