# 🪞 Public SDK Mirror

The canonical SDK source lives in this monorepo at `sdk/`. A read-only public mirror at [`orkait/rustbox-sdk`](https://github.com/orkait/rustbox-sdk) is auto-synced from `sdk/` on every push to `main`.

## Why

- Customers can read the source of the SDK they install.
- npm / PyPI / crates.io / pkg.go.dev pages can link to a public source URL.
- Issue triage stays in this private monorepo.

## Setup (one-time)

The workflow at `.github/workflows/sync-public-sdk.yml` uses [`s0/git-publish-subdir-action`](https://github.com/s0/git-publish-subdir-action). To enable it:

1. **Create the public mirror repo** (if it does not already exist):

   ```bash
   gh repo create orkait/rustbox-sdk \
     --public \
     --description "Public mirror of the Rustbox SDKs (auto-synced from orkait/rustbox)." \
     --homepage "https://rustbox.orkait.com" \
     --add-readme=false
   ```

2. **Generate an SSH deploy key** with write access to the mirror:

   ```bash
   ssh-keygen -t ed25519 -f /tmp/rustbox-sdk-mirror -N "" -C "rustbox-sdk-mirror"
   ```

   Add the public key to the mirror repo as a deploy key with write access:

   ```bash
   gh repo deploy-key add /tmp/rustbox-sdk-mirror.pub \
     --repo orkait/rustbox-sdk \
     --title "monorepo sync" \
     --allow-write
   ```

3. **Add the private key as a secret on the monorepo**:

   ```bash
   gh secret set SDK_MIRROR_DEPLOY_KEY \
     --repo orkait/rustbox \
     < /tmp/rustbox-sdk-mirror
   ```

4. **Delete the local key copies**:

   ```bash
   shred -u /tmp/rustbox-sdk-mirror /tmp/rustbox-sdk-mirror.pub
   ```

That is the full setup. After this the workflow runs on every `main` push that touches `sdk/`.

## What gets mirrored

- Every file under `sdk/` (TypeScript, Python, Go, Rust, READMEs, WEBHOOKS.md, ROADMAP.md).
- Commit messages preserve the source SHA: `sync from rustbox@<sha>`.

## What does NOT get mirrored

- The rest of the monorepo (rustbox-service, ui, deploy, docs, plans).
- The `.github/` workflows themselves.
- Anything in the monorepo `.gitignore` (build artifacts, `.venv`, `target/`, `node_modules`, `dist`).

## Direction

One way: monorepo → mirror. Pushes to `orkait/rustbox-sdk` directly are overwritten on the next sync. Pull requests should target `orkait/rustbox` (open an issue first).

## Manual run

```bash
gh workflow run sync-public-sdk.yml --repo orkait/rustbox
```

Or visit Actions → "Sync sdk/ -> public mirror" → "Run workflow" on the GitHub UI.
