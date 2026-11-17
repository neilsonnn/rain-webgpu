# wire-glass

Private working repository for the wired-glass greenhouse and interactive WebGPU rain. The complete website project was preserved here from the working `site` checkout, including its other pages, source, tests, saved glass defaults and public assets.

Glass development continues here. The original site draft PR is https://github.com/neilsonnn/site/pull/2, checkpoint `6a3b956`.

Run the app with the commands below, then open **http://127.0.0.1:5173/glass/**. The glass app requires WebGPU. Its implementation notes are in [the rain README](neilsonks/src/glass/rain/README.md).

Source for Neilson’s websites. Each website lives in its own folder directly under the repository root, with its own dependencies and build configuration.

## Websites

| Folder | Website |
| --- | --- |
| [`neilsonks`](neilsonks/README.md) | neilsonks.com — portfolio, books, About page, and fullscreen Chess homepage |

## Run neilsonks locally

```sh
cd neilsonks
npm ci
npm run dev
```

Validate and build with `npm run check` and `npm run build` from the same folder. Publish only `neilsonks/dist/` to a static host.

## Repository layout

```text
wire-glass/
  neilsonks/
    public/
    src/
    tests/
    package.json
    package-lock.json
```

Add future websites beside `neilsonks/`. Each site can be built and deployed independently.

The original website repository and standalone chess project remain separate. Writing drafts, private original-site backups, dependencies, build output, and local screenshots are excluded from this repository.

## Deployment

[Webdock deployment setup and the remaining launch tasks](DEPLOYMENT.md) describe the GitHub Actions workflow, required server settings, safe staging, rollback, and enabling deploy-on-push after the live-file audit.
