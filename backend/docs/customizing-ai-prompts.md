# Customizing AI Prompts

The AI provider's prompts live in one file (`services/ai/prompts.ts`) and can
be overridden at deploy time via env vars — no code changes, no redeploy.

---

## How it works

- **Defaults** are exported as `DEFAULT_AI_PROMPT_INITIAL`, `DEFAULT_AI_PROMPT_SHORTEN`,
  `DEFAULT_AI_PROMPT_EXTRACT` constants in `services/ai/prompts.ts`.
- **Overrides** are read by `config.ts` from three optional env vars:
  `AI_PROMPT_INITIAL`, `AI_PROMPT_SHORTEN`, `AI_PROMPT_EXTRACT`.
- Each entry resolves at module load: `override || default`.
- The provider (`anthropic.provider.ts`) calls `renderPrompt(prompts.X, vars)`
  which substitutes `{{placeholder}}` markers with the values it passes in.
  Signature: `renderPrompt(template: string, vars: Record<string, string>) => string`.

---

## Template syntax

Strict double-curly Mustache style: `{{name}}`. Internal whitespace is NOT
tolerated — `{{ name }}` stays literal.

> **Watch out:** the syntax is `{{var}}`, not `${var}`. JS template-literal
> syntax in a default constant looks correct but gets evaluated at compile
> time instead of by `renderPrompt`, producing the wrong value silently.

| Prompt | Required placeholders |
|---|---|
| `initial` | `{{maxLength}}`, `{{questions}}` |
| `shorten` | `{{maxLength}}`, `{{previousAttempt}}` |
| `extract` | `{{questions}}`, `{{conversation}}` |

If an override is set but missing a required placeholder, `prompts.ts` logs a
`console.warn` at startup and continues to boot.

---

## Overriding an existing prompt

```bash
# Your local .env file (or cloudrun.tf env { } block for deployed env)
AI_PROMPT_INITIAL="Write a brief SMS under {{maxLength}} chars.\nQuestions:\n{{questions}}"
```

Use HCL heredoc (`<<-EOT ... EOT`) in `cloudrun.tf` for multi-line values.

---

## Adding a new prompt

Five files change. Briefly:

1. `services/ai/prompts.ts` — add `DEFAULT_AI_PROMPT_X`, an entry in the
   `prompts` object, and required placeholders in `REQUIRED_PLACEHOLDERS`.
2. `config.ts` — add `x: z.string().optional()` to the `aiPrompts` schema
   and `x: process.env.AI_PROMPT_X` to the parse call.
3. `.env.example` — add the new env var name.
4. `anthropic.provider.ts` — call `renderPrompt(prompts.x, { ...vars })` at
   the new call site.
5. `prompts.test.ts` — add a placeholder-presence assertion to the default
   prompts describe block.

---

## Related files

| File | Role |
|---|---|
| `services/ai/prompts.ts` | Defaults, render function, startup validation |
| `services/ai/prompts.test.ts` | 14-test suite |
| `services/ai/providers/anthropic.provider.ts` | Call sites |
| `config.ts` | Reads `AI_PROMPT_*` env vars |
| `.env.example` | Documents the env vars |
| `../../sms-cost-reduction-plan.md` | Why this mechanism exists |
