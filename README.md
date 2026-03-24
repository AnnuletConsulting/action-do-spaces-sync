# action-do-spaces-sync

A GitHub Action that syncs a local folder to a [DigitalOcean Spaces](https://www.digitalocean.com/products/spaces) bucket using `aws s3 sync`.

## Prerequisites

This action must be preceded by [`digitalocean/action-doctl`](https://github.com/digitalocean/action-doctl) in your workflow so that `doctl` is installed and authenticated.

`aws` CLI must also be available on the runner (it is pre-installed on GitHub-hosted runners).

## How it works

1. Verifies `doctl` is installed and authenticated — fails fast with a clear message if not.
2. Unless you supply your own credentials (see `access-key` / `secret-key`), it creates a short-lived Spaces key named `gha-do-sync-<RFC-3339-timestamp>` with `readwrite` permission scoped to your bucket.
3. Runs `aws s3 sync` against the DigitalOcean Spaces endpoint, forwarding all user-supplied options.
4. **Always** deletes the temporary key after the sync completes — even if the sync fails — so no leftover credentials accumulate in your account. (This step is skipped when you provide your own key pair.)

## Usage

```yaml
- name: Authenticate doctl
  uses: digitalocean/action-doctl@v2
  with:
    token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

- name: Sync to DigitalOcean Spaces
  uses: AnnuletConsulting/action-do-spaces-sync@v1
  with:
    spaces-bucket: my-bucket
    spaces-region: nyc3
    spaces-folder: builds/production
    repo-folder: ./dist
    is-public: 'true'
    delete: 'true'
```

### Using your own credentials (skip temporary key creation)

If you already have a long-lived Spaces key pair stored as secrets, pass them directly.
The action will use them as-is and will **not** create or delete a temporary key.

```yaml
- name: Sync to DigitalOcean Spaces (own credentials)
  uses: AnnuletConsulting/action-do-spaces-sync@v1
  with:
    spaces-bucket: my-bucket
    spaces-region: nyc3
    access-key: ${{ secrets.DO_SPACES_ACCESS_KEY }}
    secret-key: ${{ secrets.DO_SPACES_SECRET_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `spaces-bucket` | **Yes** | — | Name of the DigitalOcean Spaces bucket. |
| `spaces-region` | **Yes** | — | Spaces region (e.g. `nyc3`, `sfo3`, `ams3`, `sgp1`, `fra1`, `syd1`). |
| `spaces-folder` | No | _(bucket root)_ | Destination folder path inside the bucket. Omit to sync to the bucket root. |
| `is-public` | No | `false` | Set `true` to apply `public-read` ACL to all synced objects. |
| `repo-folder` | No | `.` | Local folder to sync. Defaults to the entire repository workspace. |
| `delete` | No | `false` | Set `true` to delete destination files that no longer exist in the source (mirrors `aws s3 sync --delete`). |
| `access-key` | No | — | Optional Spaces access key. When **both** `access-key` and `secret-key` are supplied the action skips temporary key creation/deletion and uses these credentials directly. |
| `secret-key` | No | — | Optional Spaces secret key. See `access-key` above. |

## Minimal example

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Sync dist/ to Spaces
        uses: AnnuletConsulting/action-do-spaces-sync@v1
        with:
          spaces-bucket: my-project-assets
          spaces-region: nyc3
```

## Full example

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm ci && npm run build

      - name: Authenticate doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Sync build output to Spaces
        uses: AnnuletConsulting/action-do-spaces-sync@v1
        with:
          spaces-bucket: my-project-assets
          spaces-region: sfo3
          spaces-folder: releases/${{ github.ref_name }}
          repo-folder: ./dist
          is-public: 'true'
          delete: 'true'
```

## License

MIT
