---
name: codex-security-validate
description: Validate one or more candidate security findings. Run `codex-security validate --help` for usage details.
requires_bin: codex-security
command: codex-security validate
---

# codex-security validate

Validate one or more candidate security findings.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `findings...` | `string` | yes | Finding text or a file containing findings. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--effort` | `string` |  | Model reasoning effort (default: xhigh). |
| `--codex` | `array` |  | Repeat TOML model="gpt-5.6-terra" or model_reasoning_effort="high" only. |

> Confirm with the user before executing this destructive command.
