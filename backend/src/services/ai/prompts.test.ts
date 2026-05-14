import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prompts, renderPrompt } from './prompts.js'

describe('renderPrompt', () => {
  it('substitutes a single placeholder', () => {
    const template = 'Hello {{name}}'
    const vars     = { name: 'World' }
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    expect(result).toBe('Hello World')
  })

  it('substitutes multiple placeholders', () => {
    const template = '{{a}} and {{b}}'
    const vars     = { a: 'x', b: 'y' }
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    expect(result).toBe('x and y')
  })

  it('substitutes the same placeholder multiple times', () => {
    const template = '{{x}} {{x}}'
    const vars     = { x: 'hi' }
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    expect(result).toBe('hi hi')
  })

  it('returns empty string for unknown placeholders', () => {
    const template = 'Hello {{name}}'
    const vars     = {}
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    expect(result).toBe('Hello ')
  })

  it('leaves text without placeholders unchanged', () => {
    const template = 'Plain text'
    const vars     = {}
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    expect(result).toBe('Plain text')
  })

  it('ignores placeholders with surrounding whitespace', () => {
    const template = '{{ var }}'
    const vars     = { var: 'x' }
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    expect(result).toBe('{{ var }}')   // strict — `{{` must be immediately followed by \w+
  })

  it('does not interpret replacement values as regex special chars', () => {
    const template = '{{x}}'
    const vars     = { x: '$1 and $&' }
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    // Function replacements in String.replace() return values verbatim — `$1` / `$&`
    // are NOT interpreted as backrefs. Guard against any refactor that switches
    // to a string-replacement implementation.
    expect(result).toBe('$1 and $&')
  })

  it('handles multi-line templates', () => {
    const template = 'Line 1: {{a}}\nLine 2: {{b}}'
    const vars     = { a: 'x', b: 'y' }
    const result   = renderPrompt(template, vars)
    console.log({ template, vars, result })
    expect(result).toBe('Line 1: x\nLine 2: y')
  })
})

describe('default prompts contain required placeholders', () => {
  // Guards against accidental edits to the DEFAULT_AI_PROMPT_* constants
  // that drop a placeholder the provider passes in. If one disappears, the
  // generated prompt would render with that data missing — silent failure.

  it('initial', () => {
    expect(prompts.initial).toContain('{{maxLength}}')
    expect(prompts.initial).toContain('{{questions}}')
  })

  it('shorten', () => {
    expect(prompts.shorten).toContain('{{maxLength}}')
    expect(prompts.shorten).toContain('{{previousAttempt}}')
  })

  it('extract', () => {
    expect(prompts.extract).toContain('{{questions}}')
    expect(prompts.extract).toContain('{{conversation}}')
  })
})

describe('env var overrides', () => {
  // These tests re-import prompts.ts after setting env vars, so each one
  // gets a fresh module evaluation with the current process.env state.
  // The top-level `import { prompts }` above is unaffected — it stays bound
  // to the original load.

  // Env vars this test file manipulates. The pre-test value of each is
  // snapshotted in beforeEach and restored in afterEach — works whether
  // the var was already set (e.g. by .env.test or the shell) or unset.
  const ENV_VARS = ['AI_PROMPT_INITIAL', 'AI_PROMPT_SHORTEN', 'AI_PROMPT_EXTRACT'] as const
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.resetModules()      // clear module cache → next dynamic import re-evaluates prompts.ts
    for (const name of ENV_VARS) {
      originalEnv[name] = process.env[name]
    }
  })
  afterEach(() => {
    for (const name of ENV_VARS) {
      if (originalEnv[name] === undefined) {
        delete process.env[name]                  // was unset → keep unset
      } else {
        process.env[name] = originalEnv[name]     // was set → restore original value
      }
    }
  })

  it('uses AI_PROMPT_INITIAL when set', async () => {
    const override = 'CUSTOM TEMPLATE under {{maxLength}} with {{questions}}'
    process.env.AI_PROMPT_INITIAL = override
    const { prompts } = await import('./prompts.js')
    console.log({ envSet: process.env.AI_PROMPT_INITIAL, resolvedInitial: prompts.initial })
    expect(prompts.initial).toBe(override)
  })

  it('falls back to DEFAULT_AI_PROMPT_INITIAL when AI_PROMPT_INITIAL is unset', async () => {
    delete process.env.AI_PROMPT_INITIAL
    const { prompts } = await import('./prompts.js')
    console.log({ envSet: process.env.AI_PROMPT_INITIAL, resolvedInitial: prompts.initial })
    // Match distinctive content from the default — robust against whitespace tweaks
    expect(prompts.initial).toContain('Write a friendly SMS message')
    expect(prompts.initial).toContain('{{maxLength}}')
  })

  it('warns when AI_PROMPT_INITIAL is missing required placeholders', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.AI_PROMPT_INITIAL = 'override with no placeholders'
    await import('./prompts.js')
    console.log({ calls: warnSpy.mock.calls.length, lastMessage: warnSpy.mock.calls.at(-1)?.[0] })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('AI_PROMPT_INITIAL is missing required placeholder(s)'),
    )
    warnSpy.mockRestore()
  })
})
