// Centralized prompt templates for the AI provider.
//
// Defaults live as DEFAULT_AI_PROMPT_* constants below. Each can be overridden
// via the AI_PROMPT_* env vars (read through config.aiPrompts) without
// touching code — useful for testing prompt variants.
//
// Templates use {{name}} placeholders, substituted at call time by renderPrompt().

import { config } from '../../config.js'

// ─── Default templates ────────────────────────────────────────────────────────

const DEFAULT_AI_PROMPT_INITIAL = [
  `Write a friendly SMS message that includes all of the following questions.`,
  `The message must be under {{maxLength}} characters.`,
  `Use a warm, conversational tone — as if a colleague sent it, not a system.`,
  `Do not include any names or greetings. Do not use markdown or bullet points.`,
  `Return only the message text — no explanation, no quotes.`,
  ``,
  `Questions:`,
  `{{questions}}`,
].join('\n')

const DEFAULT_AI_PROMPT_SHORTEN = [
  `The following SMS message is too long (exceeds {{maxLength}} characters).`,
  `Shorten it while keeping all the questions and the same friendly tone.`,
  `Return only the shortened message — no explanation.`,
  ``,
  `Original message:`,
  `{{previousAttempt}}`,
].join('\n')

const DEFAULT_AI_PROMPT_EXTRACT = [
  `You are extracting answers from an SMS conversation between a system and a participant.`,
  ``,
  `Questions (0-indexed):`,
  `{{questions}}`,
  ``,
  `Conversation:`,
  `{{conversation}}`,
  ``,
  `Return a JSON object with exactly this shape:`,
  `{`,
  `  "answers": [`,
  `    { "questionIndex": 0, "answer": "string or null", "confident": true }`,
  `  ],`,
  `  "followUp": "string or null"`,
  `}`,
  ``,
  `Rules:`,
  `- Include one entry per question in "answers"`,
  `- answer: null and confident: false if the participant has not answered or is unclear`,
  `- answer: string and confident: true only when you are certain of the answer`,
  `- followUp: null if all questions are confidently answered`,
  `- followUp: a friendly, rephrased message for unanswered questions only — do not copy the originals`,
  `- Never invent or guess answers`,
  `- Return only valid JSON — no explanation, no markdown`,
].join('\n')

// ─── Resolved prompts ─────────────────────────────────────────────────────────
// Env var (via config.aiPrompts) wins if set; otherwise fall back to default.

export const prompts = {
  initial: config.aiPrompts.initial || DEFAULT_AI_PROMPT_INITIAL,
  shorten: config.aiPrompts.shorten || DEFAULT_AI_PROMPT_SHORTEN,
  extract: config.aiPrompts.extract || DEFAULT_AI_PROMPT_EXTRACT,
}

// ─── Template renderer ────────────────────────────────────────────────────────
// Replaces {{name}} with vars[name]. Unknown placeholders become empty strings.

export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

// ─── Validation (warn, never crash) ───────────────────────────────────────────
// If an override is set but missing required placeholders, log a warning at
// startup. The backend still boots — degraded prompt is better than no service.

const REQUIRED_PLACEHOLDERS: Record<keyof typeof prompts, readonly string[]> = {
  initial: ['maxLength', 'questions'],
  shorten: ['maxLength', 'previousAttempt'],
  extract: ['questions', 'conversation'],
}

for (const key of Object.keys(prompts) as (keyof typeof prompts)[]) {
  if (!config.aiPrompts[key]) continue   // using default — known-good
  const envVar = `AI_PROMPT_${key.toUpperCase()}`
  const missing = REQUIRED_PLACEHOLDERS[key].filter(ph => !prompts[key].includes(`{{${ph}}}`))
  if (missing.length > 0) {
    console.warn(
      `[prompts] ${envVar} is missing required placeholder(s): ` +
      `${missing.map(p => `{{${p}}}`).join(', ')}. ` +
      `The rendered prompt may produce unexpected output.`
    )
  }
}
