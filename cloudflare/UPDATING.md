# Updating and rolling back Nodus Cloud

The installation created by **Deploy to Cloudflare** lives in a copy of the repository that belongs to the user. Nodus Desktop has no access to that copy or to the Cloudflare account.

## Updating

1. Read the release notes for the new version of Nodus and its migrations.
2. Bring the changes published at `https://github.com/jorgepb96/nodus/tree/main/cloudflare` into your copy, through the GitHub/GitLab interface or with Git.
3. Commit the changes. Workers Builds runs `npm run deploy`, applies the D1 migrations and publishes the Worker.
4. Open Nodus Desktop and force a synchronisation to confirm the connection.

Migrations must be forward compatible. Export D1 and keep the recovery key before a major update.

## Rolling back

Cloudflare can return the Worker to an earlier version or deployment from its dashboard. That rolls back the code, not the D1 database. Do not roll back a destructive migration without a specific restore procedure.

Official documentation: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [versions and deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/), [import and export D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Synchronization hardening requires migration `0005_sync_safety.sql` together with the updated Worker. Deploy both through the existing migration-first update workflow. The new utility replica importer also requires the updated Desktop build; existing deployments are not changed by local tests.
