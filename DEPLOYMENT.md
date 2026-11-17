# Deploy neilsonks to Webdock

The [Neilsonks — Webdock workflow](.github/workflows/neilsonks-webdock.yml) runs on relevant pushes to `main`, pull requests, and manual runs. It uses Node.js 22, installs the lockfile with `npm ci`, runs the deployment-helper tests and all simulation checks, builds the site, and verifies that writing and archival sources are excluded.

**Live as of October 13, 2026.** Webdock serves `/var/www/neilsonks-deploy/current` at [neilsonks.com](https://neilsonks.com). GitHub SSH credentials are configured, live release verification is enabled, and relevant pushes to `main` publish automatically. Pull requests only validate.

The first production deployment was [Actions run 38510820107](https://github.com/neilsonnn/site/actions/runs/38510820107). Nonvisual HTTP checks confirmed active pages and aliases, linked JS/CSS, canonical redirects, the reconciled résumé and video, favicon, sitemap, robots.txt, and real 404 responses for excluded content. Webdock's Test Certbot event completed without errors after the root change.

## Manual options

In GitHub, open **Actions → Neilsonks — Webdock → Run workflow**, select `main`, and choose:

| Option | Result |
| --- | --- |
| `check` (default) | Test and build; no server connection. |
| `stage` | Test, build, and upload a new inactive release. The live site stays unchanged. |
| `publish` | Test, build, upload, and atomically switch the `current` symlink. |

Publishing and automatic deployment are restricted to `main`. Pull requests cannot deploy or receive deployment secrets. Successful builds upload only `neilsonks/dist/`, not the repository or private backups.

## Required GitHub settings

Open **Settings → Secrets and variables → Actions** in `neilsonnn/site`.

Add these **repository secrets**:

| Secret | Value |
| --- | --- |
| `WEBDOCK_HOST` | Your VPS hostname or IPv4 address. |
| `WEBDOCK_USER` | Currently `admin`, using the Neilsonks Deployment key. The workflow only writes to the deployment directory and never uses `sudo`. A dedicated restricted deployment account can be introduced later. |
| `WEBDOCK_SSH_KEY` | The private deployment key, without a passphrase. Put its public key in the SSH user's `authorized_keys`. Do not paste the private key into chat or commit it. |
| `WEBDOCK_KNOWN_HOSTS` | OpenSSH `known_hosts` entries for this server. Verify the host-key fingerprint through the trusted Webdock console before storing it. For a nonstandard port, the host entry uses `[hostname]:port`. |

Add these **repository variables**:

| Variable | Value |
| --- | --- |
| `WEBDOCK_DEPLOY_PATH` | A dedicated absolute directory outside the current public webroot, for example `/var/www/neilsonks-deploy`. No spaces. |
| `WEBDOCK_SSH_PORT` | SSH port; defaults to `22`. |
| `WEBDOCK_SITE_URL` | The canonical HTTPS site URL, e.g. `https://neilsonks.com`. After the webroot cutover, this enables release verification and automatic rollback on failure. Leave unset for the first staged setup before the new webroot is active. |
| `WEBDOCK_AUTO_DEPLOY` | Currently `true`: relevant pushes to `main` publish automatically. Set to `false` to pause automatic publication; manual checks and staging remain available. |

The scripts enforce host-key verification. They do not use `StrictHostKeyChecking=no`, change the server's configuration, or delete/mirror the existing live directory.

## Server layout and preparation

The deployment user needs SSH access, Bash, Python 3, `rsync`, and permission to create releases and symlinks. Apache/Nginx must be able to read the files. The scripts do not use `sudo`.

```text
/var/www/neilsonks-deploy/
  releases/
    <commit>-<run>-<attempt>/
      index.html
      assets/
      ...
  current  -> releases/<live-release>
  previous -> releases/<previous-release>
```

Every upload gets a new release directory. `stage` does not touch `current`. `publish` atomically changes `current` and keeps the preceding release available through `previous`. Existing regular directories/files named `current` or `previous` are not overwritten.

**Webdock's website root must point to `<WEBDOCK_DEPLOY_PATH>/current` for published releases to appear on your domain.** Changing that setting is a separate step; the workflow never does it. Use a dedicated deployment directory outside the old webroot so inactive releases and rollback metadata cannot be served publicly.

## Launch record and backups

1. **Live-file audit and reconciliation are complete (October 11).** The live résumé replaces the older local PDF, and `webm/tendarLowRes.mp4` is included at its existing URL. The alternate old résumé, Wake Up Claude page, Christmas, obsolete UI assets, server configuration/logging files, and editor metadata are excluded. Historical portfolio media is retained. Audit records and removed-file backups are outside the repository at `/Users/neilson/Desktop/life-chat/site-audit-2026-10-11/`. No live server files were changed.
2. **Original live site preserved.** `/var/www/html` remains intact. The complete prelaunch archive is `/home/admin/neilsonks-backups/before-launch-2026-10-13.tar.gz` on the server and `/Users/neilson/Desktop/life-chat/site-live-backup-2026-10-13/before-launch-2026-10-13.tar.gz` on the Mac. Both have SHA-256 `fdbef4c6886d69e16246575c8af8656063970771adca5a24d4d4bf3feea04c81`. Copies of Apache site configuration and certificate-renewal configuration are alongside them in `apache-sites-before-launch/` and `letsencrypt-renewal-before-launch/`. Private certificate keys were not copied. No additional Webdock snapshot was created.
3. **Server access configured.** SSH uses `admin@neilson.vps.webdock.cloud` on port 22. The deployment directory is owned by `admin` and readable by Apache. The server host fingerprint was verified through the authenticated Webdock console; Actions uses strict host-key checking.
4. **Cutover completed through Webdock.** The dashboard updated the webserver and Let's Encrypt configuration to `/var/www/neilsonks-deploy/current`. The phpMyAdmin shortcut automatically added to the release by Webdock was removed; the system installation was retained. HTTPS and apex/`www` redirects passed live checks.
5. **Automatic publication enabled.** `WEBDOCK_SITE_URL=https://neilsonks.com` verifies each published release ID, and `WEBDOCK_AUTO_DEPLOY=true` enables relevant pushes to `main`. The one-time webroot setup is complete; subsequent deployments only switch the `current` symlink.

Optional follow-ups: submit the sitemap in Search Console, consider build-time prerendering, decide whether to restore analytics, and establish release retention. Old releases currently remain on disk; monitor space and retain the current and preceding releases when introducing cleanup. Browser, viewport, and visual verification require an explicit request under `AGENTS.md`.

## Verification and rollback

Each release includes `_deployment.json` containing its commit and release ID. If `WEBDOCK_SITE_URL` is set, the deployment checks that the public URL returns the new release ID. Failure automatically restores the preceding symlink and fails the workflow. This is a release verification check; it does not replace testing page interactions and WebGL.

Without `WEBDOCK_SITE_URL`, publication still validates the built files and manifest on the server, but cannot prove the public domain is serving them. Always configure the URL after the initial cutover.

To return to a prior release manually, use SSH to inspect `current` and `previous`, then atomically point `current` to the chosen directory. The retained directories also allow restoring an older release. The workflow will not overwrite a newer live release during an automatic rollback.

To restore the original prelaunch website, first set `WEBDOCK_AUTO_DEPLOY=false`, then use Webdock's root-change form to set `/var/www/html` with both webserver and Let's Encrypt configuration updates selected. Run Test Certbot afterwards. This avoids extracting the backup or deleting the new releases. Automatic rollback and switching to the original webroot were documented and source-reviewed; no intentional live failure was injected during launch.
