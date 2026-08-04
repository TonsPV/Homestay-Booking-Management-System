---
name: codex-security-scan
description: Run a Codex Security scan. Run `codex-security scan --help` for usage details.
requires_bin: codex-security
command: codex-security scan
---

# codex-security scan

Run a Codex Security scan.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repository` | `string` | no | Repository root to scan (default: current directory). |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--auth` | `string` | `auto` | Select ChatGPT, OPENAI_API_KEY/CODEX_API_KEY, or automatic authentication. |
| `--path` | `array` |  | Scan only PATH; repeat for multiple repository-relative paths. |
| `--knowledgeBase` | `array` |  | Add security-context files or directories; repeat for multiple paths. |
| `--diff` | `string` |  | Scan committed Git changes from BASE to --head. |
| `--workingTree` | `boolean` | `false` | Scan staged and unstaged changes against --base. |
| `--head` | `string` |  | Git head ref for --diff (default: HEAD). |
| `--base` | `string` |  | Git base ref for --working-tree (default: HEAD). |
| `--mode` | `string` | `standard` | Scan mode; deep supports repository and path targets. |
| `--model` | `string` |  | OpenAI model to use (default: gpt-5.6-sol). |
| `--effort` | `string` |  | Model reasoning effort (default: xhigh). |
| `--outputDir` | `string` |  | Artifact directory outside the repository (default: Codex Security state; CODEX_SECURITY_STATE_DIR). |
| `--archiveExisting` | `boolean` | `false` | Archive existing results; requires --output-dir. |
| `--pluginPath` | `string` |  | Codex Security plugin directory or ZIP (default: bundled plugin). |
| `--python` | `string` |  | Python interpreter (default: PYTHON or automatic discovery). |
| `--codex` | `array` |  | Repeat TOML KEY=VALUE; e.g. model_reasoning_effort="high" or features.multi_agent_v2.max_concurrent_threads_per_session=4. |
| `--failOnSeverity` | `string` |  | Exit 1 for findings at or above LEVEL. |
| `--maxCost` | `number` |  | Stop the scan if estimated USD cost exceeds AMOUNT. |
| `--dryRun` | `boolean` | `false` | Validate local scan inputs without starting a scan. |

## Output

Type: `object`

## Examples

```sh
codex-security scan .

codex-security scan . --model gpt-5.6-terra

codex-security scan . --model gpt-5.6-terra --effort high

codex-security scan . --path src

codex-security scan . --diff origin/main

codex-security scan . --codex features.multi_agent_v2.max_concurrent_threads_per_session=4
```

> Confirm with the user before executing this destructive command.
