---
name: codex-security-bulk-scan
description: Discover repositories and run resumable bulk security scans. Run `codex-security bulk-scan --help` for usage details.
requires_bin: codex-security
command: codex-security bulk-scan
---

# codex-security bulk-scan

Discover repositories and run resumable bulk security scans.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `string` | no | CSV repository list; omit to discover repositories interactively. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--outputDir` | `string` |  | Resumable results directory; required with a repository CSV. |
| `--workers` | `number` | `4` | Concurrent repository scans. Per-scan Codex workers are separate. |
| `--mode` | `string` | `standard` | Default scan mode for repositories without a CSV mode. |
| `--model` | `string` |  | OpenAI model for each repository (default: gpt-5.6-sol). |
| `--effort` | `string` |  | Model reasoning effort (default: xhigh). |
| `--maxAttempts` | `number` | `1` | Maximum scan attempts per repository. |
| `--pluginPath` | `string` |  | Codex Security plugin directory or ZIP (default: bundled plugin). |
| `--python` | `string` |  | Python interpreter (default: PYTHON or automatic discovery). |
| `--codex` | `array` |  | Repeat TOML KEY=VALUE; e.g. model_reasoning_effort="high" or features.multi_agent_v2.max_concurrent_threads_per_session=4. |

## Output

Type: `object`

## Examples

```sh
codex-security bulk-scan --model gpt-5.6-terra --effort high
```

> CSV example:
  codex-security bulk-scan repositories.csv --output-dir /path/outside/repositories/results --workers 4 --max-attempts 3 Confirm with the user before executing this destructive command.
