import * as core from '@actions/core';
import {
  rfc3339Timestamp,
  verifyDoctl,
  createSpacesKey,
  deleteSpacesKey,
  runS3Sync,
} from './helpers.js';

async function run() {
  // ── Read inputs ─────────────────────────────────────────────────────────
  const bucket             = core.getInput('spaces-bucket', { required: true });
  const region             = core.getInput('spaces-region', { required: true });
  const spacesFolder       = core.getInput('spaces-folder') || '';
  const isPublic           = core.getBooleanInput('is-public');
  const repoFolder         = core.getInput('repo-folder') || '.';
  const deleteFlag         = core.getBooleanInput('delete');
  const providedAccessKey  = core.getInput('access-key');
  const providedSecretKey  = core.getInput('secret-key');

  const usingProvidedKey = Boolean(providedAccessKey && providedSecretKey);

  // ── Verify doctl ────────────────────────────────────────────────────────
  await verifyDoctl();

  // ── Resolve credentials ─────────────────────────────────────────────────
  let accessKey, secretKey;

  if (usingProvidedKey) {
    core.info('Using provided access-key and secret-key; skipping temporary key creation.');
    accessKey = providedAccessKey;
    secretKey = providedSecretKey;
  } else {
    const keyName = `gha-do-sync-${rfc3339Timestamp()}`;
    ({ accessKey, secretKey } = await createSpacesKey(keyName, bucket));
  }

  // Mask credentials so they never appear in logs
  core.setSecret(accessKey);
  core.setSecret(secretKey);

  // ── Sync ────────────────────────────────────────────────────────────────
  let syncError = null;
  try {
    await runS3Sync({ accessKey, secretKey, bucket, region, spacesFolder, repoFolder, isPublic, deleteFlag });
  } catch (err) {
    syncError = err;
  } finally {
    // Delete the temporary key even when sync fails — skip if user supplied key
    if (!usingProvidedKey) {
      await deleteSpacesKey(accessKey);
    }
  }

  if (syncError) {
    core.setFailed(syncError.message);
  }
}

run().catch((err) => core.setFailed(err.message));
