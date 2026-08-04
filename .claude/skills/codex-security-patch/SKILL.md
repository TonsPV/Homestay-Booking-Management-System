---
name: codex-security-patch
description: Patch one or more security issues. Run `codex-security patch --help` for usage details.
requires_bin: codex-security
command: codex-security patch
---

# codex-security patch

Patch one or more security issues.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `issues...` | `string` | yes | Issue text or a file containing issues. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--effort` | `string` |  | Model reasoning effort (default: xhigh). |
| `--codex` | `array` |  | Repeat TOML model="gpt-5.6-terra" or model_reasoning_effort="high" only. |

> Confirm with the user before executing this destructive command.
