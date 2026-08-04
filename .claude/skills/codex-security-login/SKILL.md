---
name: codex-security-login
description: Sign in with ChatGPT or store credentials. Run `codex-security login --help` for usage details.
requires_bin: codex-security
command: codex-security login
---

# codex-security login

Sign in with ChatGPT or store credentials.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `string` | no | Show login status. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--deviceAuth` | `boolean` | `false` | Use device-code authentication. |
| `--withApiKey` | `boolean` | `false` | Read an API key from stdin. |
| `--withAccessToken` | `boolean` | `false` | Read an access token from stdin. |

> Confirm with the user before executing this destructive command.
