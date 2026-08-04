---
name: codex-security-install-hook
description: Install a Git pre-commit security scan. Run `codex-security install-hook --help` for usage details.
requires_bin: codex-security
command: codex-security install-hook
---

# codex-security install-hook

Install a Git pre-commit security scan.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repository` | `string` | no | Git repository (default: current directory). |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--failOnSeverity` | `string` | `high` | Block commits for findings at or above LEVEL. |

## Output

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hook` | `string` | yes |  |
| `failOnSeverity` | `string` | yes |  |

> Confirm with the user before executing this destructive command.
