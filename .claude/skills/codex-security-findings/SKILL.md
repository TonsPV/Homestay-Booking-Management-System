---
name: codex-security-findings
description: Review and manage saved Codex Security findings. Run `codex-security findings --help` for usage details.
requires_bin: codex-security
command: codex-security findings
---

# codex-security findings false-positive

Mark a finding as a false positive for future scans.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `occurrenceId` | `string` | yes | Finding occurrence identifier. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--reason` | `string` |  | Explanation for why the finding is a false positive. |

## Output

Type: `object`

> Confirm with the user before executing this destructive command.
