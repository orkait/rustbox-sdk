# 📦 Publishing the SDKs

Each SDK ships through its native package registry via a tag-triggered GitHub Actions workflow.

| SDK | Registry | Tag pattern | Workflow |
|---|---|---|---|
| TypeScript | npm (`rustbox`) | `sdk/ts/v*` | `.github/workflows/publish-sdk-typescript.yml` |
| Python | PyPI (`rustbox`) | `sdk/py/v*` | `.github/workflows/publish-sdk-python.yml` |
| Rust | crates.io (`rustbox-sdk`) | `sdk/rust/v*` | `.github/workflows/publish-sdk-rust.yml` |
| Go | pkg.go.dev (`github.com/orkait/rustbox-sdk/go`) | `sdk/go/v*` | `.github/workflows/publish-sdk-go.yml` |

## How a release works

```bash
# Pick a language + version
LANG=ts        # ts | py | rust | go
VERSION=0.1.0

# From main, after the change is merged:
git tag "sdk/$LANG/v$VERSION"
git push origin "sdk/$LANG/v$VERSION"
```

The workflow:

1. Resolves the version from the tag (`sdk/ts/v0.1.0` -> `0.1.0`).
2. Writes that version into `package.json` / `pyproject.toml` / `Cargo.toml`.
3. Runs the language's test suite.
4. Builds + publishes to the registry.

Go is special: it does not "publish" a tarball. The workflow tags the public mirror at `go/v<version>` so `go get github.com/orkait/rustbox-sdk/go@v<version>` resolves.

## One-time setup (per registry)

### npm

```bash
# 1. Create npm automation token at https://www.npmjs.com/settings/<user>/tokens
#    Type: "Automation" (CI-friendly, bypasses 2FA on publish)
gh secret set NPM_TOKEN --repo orkait/rustbox < /tmp/npm-token
```

### PyPI

Two options:

**Option A: Token (simpler)**

```bash
# 1. Create token at https://pypi.org/manage/account/token/
#    Scope: project "rustbox" (after first manual upload of v0.0.0 placeholder)
gh secret set PYPI_API_TOKEN --repo orkait/rustbox < /tmp/pypi-token
```

**Option B: Trusted Publishers (preferred, no token rotation)**

1. PyPI dashboard -> project "rustbox" -> Publishing -> Add trusted publisher.
2. Owner: `orkait`, Repository: `rustbox`, Workflow: `publish-sdk-python.yml`, Environment: leave blank.
3. The workflow auto-falls back to OIDC when `PYPI_API_TOKEN` is unset.

### crates.io

```bash
# 1. cargo login at https://crates.io/me - copy the token
gh secret set CRATES_IO_TOKEN --repo orkait/rustbox < /tmp/crates-token
```

Crates.io requires the package name to be available. `rustbox-sdk` is the chosen name (Cargo.toml). First publish claims it.

### Go

No new secret needed. The workflow reuses `SDK_MIRROR_DEPLOY_KEY` (already configured for the public mirror sync) to push tags to `orkait/rustbox-sdk`.

## First release: ordering

The Go workflow waits 30s after the tag push so the `sync-public-sdk` workflow has time to publish the latest `sdk/` to the mirror before the Go workflow tags it. If the timing is tight, run the sync workflow manually first:

```bash
gh workflow run sync-public-sdk.yml --repo orkait/rustbox
# wait ~30s
git tag sdk/go/v0.1.0 && git push origin sdk/go/v0.1.0
```

## Verifying a release

| SDK | Where it shows up |
|---|---|
| TypeScript | <https://www.npmjs.com/package/rustbox> |
| Python | <https://pypi.org/project/rustbox/> |
| Rust | <https://crates.io/crates/rustbox-sdk> + <https://docs.rs/rustbox-sdk> |
| Go | `go list -m -versions github.com/orkait/rustbox-sdk/go` (pkg.go.dev indexes within minutes of first use) |

## Yanking a bad release

| Registry | Command |
|---|---|
| npm | `npm deprecate rustbox@<version> "<reason>"` (cannot unpublish after 24h) |
| PyPI | PyPI dashboard -> project -> Releases -> "Yank" the version |
| crates.io | `cargo yank --version <version> rustbox-sdk` |
| Go | Cannot unpublish; bump the version and document the bad one in CHANGELOG |

Yanked versions stop new installs. Existing pinned consumers keep working.
