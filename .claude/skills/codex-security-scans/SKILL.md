---
name: codex-security-scans
description: List, inspect, rerun, match, and compare saved Codex Security scans. Run `codex-security scans --help` for usage details.
requires_bin: codex-security
command: codex-security scans
---

# codex-security scans compare

Compare findings and coverage using saved matches.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `beforeId` | `string` | yes | Earlier saved scan identifier. |
| `afterId` | `string` | yes | Later saved scan identifier. |

## Output

Type: `object`

---

# codex-security scans list

List saved scans for a repository or scan root.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repository` | `string` | no | Repository to inspect (default: current directory). |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--scanRoot` | `string` |  | Include scans whose output is under ROOT. |

## Output

Type: `object`

---

# codex-security scans match

Match findings by root cause across saved scans.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `beforeId` | `string` | no | Earlier saved scan identifier. |
| `afterId` | `string` | no | Later saved scan identifier. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--all` | `boolean` | `false` | Match all completed scans of the current repository. |
| `--force` | `boolean` | `false` | Recompute an existing semantic finding comparison. |

## Output

Type: `object`

> Confirm with the user before executing this destructive command.

---

# codex-security scans rerun

Rerun a saved scan with its original configuration.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `scanId` | `string` | yes | Saved scan identifier. |

## Output

Type: `object`

> Confirm with the user before executing this destructive command.

---

# codex-security scans show

Show the results and saved configuration for a scan.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `scanId` | `string` | yes | Saved scan identifier or unique prefix. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--showLinkedFindings` | `boolean` | `false` | Show findings linked across previous scans. |

## Output

Type: `object`
