import * as core from '@actions/core';
import * as exec from '@actions/exec';

/**
 * Returns an RFC-3339 timestamp string safe for use in a key name.
 * Colons are replaced with hyphens so the value is shell-safe.
 * Example: 2024-01-15T10-30-45Z
 *
 * @returns {string}
 */
export function rfc3339Timestamp() {
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
export async function captureOutput(cmd, args, options = {}) {
  let stdout = '';
  let stderr = '';
  const exitCode = await exec.exec(cmd, args, {
    ...options,
    listeners: {
      stdout: (data) => { stdout += data.toString(); },
      stderr: (data) => { stderr += data.toString(); },
    },
    ignoreReturnCode: true,
    silent: true,
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
export async function verifyDoctl() {
  try {
    await captureOutput('doctl', ['version']);
  } catch {
    throw new Error(
      'doctl is not installed or not found in PATH. ' +
      'Please add the digitalocean/action-doctl step before this action.',
    );
  }

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
 * Parses the JSON output of `doctl spaces keys create` and returns the
 * access key and secret key.
 *
 * @param {string} output  Raw stdout from doctl.
 * @returns {{ accessKey: string, secretKey: string }}
 */
export function parseSpacesKeyOutput(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`Failed to parse doctl spaces keys create output as JSON:\n${output}`);
  }

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
 * Builds the argument list for `doctl spaces keys create`.
 *
 * @param {string} keyName
 * @param {string} bucket
 * @returns {string[]}
 */
export function buildCreateSpacesKeyArgs(keyName, bucket) {
  return [
    'spaces', 'keys', 'create', keyName,
    '--grants', `"bucket=${bucket};permission=readwrite"`,
    '--output', 'json',
  ];
}

/**
 * Creates a temporary DigitalOcean Spaces key with read-write permission
 * scoped to the given bucket.
 *
 * @param {string} keyName  The key name to create.
 * @param {string} bucket   The Spaces bucket name.
 * @returns {Promise<{accessKey: string, secretKey: string}>}
 */
export async function createSpacesKey(keyName, bucket) {
  core.info(`Creating temporary Spaces key: ${keyName}`);
  const output = await captureOutput('doctl', buildCreateSpacesKeyArgs(keyName, bucket));
  return parseSpacesKeyOutput(output);
}

/**
 * Deletes a DigitalOcean Spaces key by its access key ID.
 * Logs a warning rather than throwing so cleanup never masks the sync error.
 *
 * @param {string} accessKey
 */
export async function deleteSpacesKey(accessKey) {
  core.info(`Deleting temporary Spaces key: ${accessKey}`);
  try {
    await captureOutput('doctl', ['spaces', 'keys', 'delete', accessKey]);
    core.info('Temporary Spaces key deleted successfully.');
  } catch (err) {
    core.warning(`Failed to delete temporary Spaces key '${accessKey}': ${err.message}`);
  }
}

/**
 * Builds the argument list for `aws s3 sync`.
 *
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.region
 * @param {string} params.spacesFolder
 * @param {string} params.repoFolder
 * @param {boolean} params.isPublic
 * @param {boolean} params.deleteFlag
 * @returns {string[]}
 */
export function buildSyncArgs({ bucket, region, spacesFolder, repoFolder, isPublic, deleteFlag }) {
  const destination = spacesFolder
    ? `s3://${bucket}/${spacesFolder.replace(/^\//, '')}`
    : `s3://${bucket}`;

  const args = [
    's3', 'sync',
    repoFolder,
    destination,
    '--endpoint-url', `https://${region}.digitaloceanspaces.com`,
  ];

  if (isPublic) args.push('--acl', 'public-read');
  if (deleteFlag) args.push('--delete');

  return args;
}

/**
 * Runs `aws s3 sync` using the provided credentials and parameters.
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
export async function runS3Sync({ accessKey, secretKey, bucket, region, spacesFolder, repoFolder, isPublic, deleteFlag }) {
  const args = buildSyncArgs({ bucket, region, spacesFolder, repoFolder, isPublic, deleteFlag });

  core.info(`Running: aws ${args.join(' ')}`);

  const exitCode = await exec.exec('aws', args, {
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: accessKey,
      AWS_SECRET_ACCESS_KEY: secretKey,
      AWS_DEFAULT_REGION: region,
    },
    ignoreReturnCode: true,
  });

  if (exitCode !== 0) {
    throw new Error(`aws s3 sync failed with exit code ${exitCode}.`);
  }
}
