# Advanced Orca Workspace pilot

This directory is the reviewable, transport-independent foundation for the Windows 3070 pilot. It deliberately exposes only Guacamole's HTTP listener on host loopback. PostgreSQL and guacd have no host-published ports; Tailscale Serve is the sole user-facing ingress. Funnel is prohibited.

Guacamole is attached to the two internal service networks plus the ordinary `ingress` bridge. The `ingress` bridge is required for Docker to realize Guacamole's host-loopback publication. It is attached to Guacamole and its proxy (`guacd`) only, allowing the proxy to reach the Windows host gateway for RDP; it is not attached to PostgreSQL and does not make Guacamole or guacd reachable from LAN, tailnet, or public interfaces.

## Guardrails

- Preserve RustDesk and direct Tailscale as recovery paths. Do not alter their services.
- Keep `.env`, `state/`, backups, evidence, private paths, passwords, TOTP seeds, user names, and tailnet addresses out of Git.
- Use the Orca configuration location reported by **Help → Show Configuration Folder** as `-SourceOrcaConfig`; do not guess it.
- The pilot Windows account is non-administrator. It receives Modify access only to the five workspace folders. Do not map repository roots, OneDrive, Docker, profiles outside the copied workbench, or printer credentials.
- Do not configure a printer target or connect the Orca Device page. RDP drive transfer remains disabled unless a later approval defines a restricted path.
- Do not enable Funnel. Do not publish RDP, VNC, PostgreSQL, guacd, or the Guacamole loopback port directly.

## First deployment

Run in an elevated PowerShell window on the 3070, from this directory. The generated `.env` and database schema live in ignored `state/` storage.

```powershell
Copy-Item .env.example .env
# Replace both database password placeholders in .env with one long random value.
New-Item -ItemType Directory -Force state\postgres-init | Out-Null
docker run --rm guacamole/guacamole:1.6.0 /opt/guacamole/bin/initdb.sh --postgresql | Set-Content -Encoding utf8 state\postgres-init\001-guacamole-schema.sql
docker compose --env-file .env -f compose.yaml config
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
```

The PostgreSQL initialization script is generated from the same pinned Guacamole image and is consumed only when the named database volume is empty. Do not run the initialization step against an existing pilot database volume.

## Workspace and profile preservation

Before creating the pilot account, open Orca locally and use **Help → Show Configuration Folder**. Then run the following, replacing the source with the UI-revealed location:

```powershell
.\Initialize-Workspace.ps1 -PilotUser '<pilot-windows-user>' -SourceOrcaConfig '<UI-revealed Orca configuration folder>'
```

The script creates a timestamped backup outside OneDrive, a private SHA-256 manifest, the exact restricted workspace tree, the non-administrator account, and an inert workspace-only copy of the user-preset directory. Network/device configuration remains in the private backup and is not copied into the workspace. It does not write to the source profile.

## Database authentication, TOTP, and RDP-first acceptance

1. Access the loopback endpoint locally only; first-login administration credentials are the upstream Guacamole schema defaults and must be changed immediately to a generated, host-managed secret.
2. Create exactly one database-authenticated Guacamole user, `<pilot-tailnet-identity>`. Enroll TOTP with the pilot's authenticator device; this is a required human step because it requires scanning the enrollment code. TOTP is mandatory for every Guacamole login through this stack.
3. Create the RDP connection only after the Windows pilot account and restricted workspace have been verified. Use the Docker Desktop host gateway and NLA; disable clipboard, drive, printer, audio-input, and graphical recording parameters. Set connection and user limits to one.
4. Run the full rendering/reconnect/logoff/service-survival matrix. Keep RDP only if it passes. If it fails, document the result and use the approved VNC fallback procedure; do not keep both transports active.

## Tailnet-only publication

After the local loopback, direct-exposure, and named-identity policy gates pass, confirm that the tailnet policy permits only the named pilot identity to reach Guacamole's separate HTTPS endpoint. Do not change the dashboard's private Serve route on HTTPS :443:

```powershell
tailscale serve --https=<guacamole-https-port> http://127.0.0.1:8085
tailscale serve status --json
tailscale funnel status
```

If Tailscale requests a web-admin approval or the narrow deny-by-default grant cannot be applied, stop after preparing the policy change; do not claim the access gate passed. Example policy intent (replace the placeholder host tag and port to match the approved tailnet):

```json
{
  "grants": [
    {
      "src": ["<pilot-tailnet-identity>"],
      "dst": ["tag:advanced-orca-workspace:<guacamole-https-port>"],
      "ip": ["tcp:<guacamole-https-port>"]
    }
  ]
}
```

## Status, backup, rollback, and removal

```powershell
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail 200
docker run --rm -v advanced-orca-workspace-postgres-data:/var/lib/postgresql/data -v ${PWD}\backups:/backup alpine:3.20 tar czf /backup/postgres-$(Get-Date -Format yyyyMMdd-HHmmss).tgz /var/lib/postgresql/data
docker compose --env-file .env -f compose.yaml down
# Do not reset Tailscale Serve here: the dashboard's HTTPS :443 route is managed separately.
docker compose --env-file .env -f compose.yaml down -v
```

`down -v` is destructive and is only the final removal step after a verified backup. It does not remove the workspace account or profile backup; remove those only under a separate, explicit retirement change.
