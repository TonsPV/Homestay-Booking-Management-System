---
name: codex-security-info
description: Show read-only SDK and bundled-plugin metadata. Run `codex-security info --help` for usage details.
requires_bin: codex-security
command: codex-security info
---

# codex-security info

Show read-only SDK and bundled-plugin metadata.

## Output

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sdkVersion` | `string` | yes |  |
| `bundledPluginVersion` | `string` | yes |  |
| `scanMcp` | `boolean` | yes |  |
| `cancellationNote` | `string` | yes |  |
| `cliVersion` | `string` | yes |  |
| `codexVersion` | `string` | yes |  |
| `codexSdkVersion` | `string` | yes |  |
| `model` | `string` | yes |  |
| `reasoningEffort` | `string` | yes |  |
| `nextStep` | `string` | yes |  |
