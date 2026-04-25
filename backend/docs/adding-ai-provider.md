# Adding a New AI Provider

The AI layer uses an interface + adapter + factory pattern. Adding a new provider
(OpenAI, Google Gemini, etc.) requires changes in exactly 4 places and zero
changes to any route, worker, or business logic.

---

## Architecture overview

```
broadcast.service.ts    ─┐
conversation.worker.ts  ─┼──▶  IAiProvider  ──▶  AnthropicProvider  (today)
                        ─┘                  ──▶  OpenAiProvider      (future)
```

The rest of the app calls `generateMessage()` and `extractAnswers()` on the
active provider instance. It never imports a provider directly.

---

## What each method does

### `generateMessage({ questions, maxLength, previousAttempt? })`

Called once per broadcast participant. Takes the list of questions the manager
configured and returns a single friendly SMS body — written in a warm,
conversational tone as if the message came from a colleague, not a system.

- The prompt must instruct the AI to stay under `maxLength` characters.
- If `previousAttempt` is provided, the previous message was too long — the AI
  must shorten it while keeping the same questions and tone.
- Returns the final message body as a plain string (no markdown, no formatting).

### `extractAnswers({ questions, messages })`

Called after every participant reply. Takes the full conversation history and the
original question list. Returns:

- `answers` — one entry per question: `{ questionIndex, answer, confident }`.
  - `answer: null` + `confident: false` → participant hasn't answered this yet.
  - `answer: string` + `confident: true` → save to the `answers` table.
- `followUp: string | null`:
  - `null` → all questions are confidently answered → mark conversation `completed`.
  - `string` → send this message to the participant and wait for their next reply.
    The follow-up must freely rephrase only the unanswered questions — not copy
    the originals — to get a clearer response.

**Key rule:** never invent answers. If the AI is not confident, return `null`.
The manager sees which questions went unanswered, not fabricated answers.

---

## Step-by-step checklist

### 1. Add env vars to `.env.example`

```bash
# Set AI_PROVIDER to switch providers (default: anthropic)
AI_PROVIDER=openai
OPENAI_API_KEY=
```

### 2. Update `src/config.ts`

The `ai` block is already generic. Update the `provider` enum to include the new
provider name:

```typescript
ai: z.object({
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),  // add new value here
  apiKey:   z.string().min(1),
}).nullable().default(null),
```

Map from `process.env` — the `ai` block is set when `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` is present. Update the detection logic:

```typescript
const aiApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY

ai: aiApiKey ? {
  provider: (process.env.AI_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai',
  apiKey:   aiApiKey,
} : null,
```

Add a startup warning (same pattern as Twilio):
```typescript
if (!config.ai) {
  console.warn(
    '[config] AI provider not configured — AI features disabled. ' +
    'Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable.'
  )
}
```

### 3. Create `src/services/ai/providers/{name}.provider.ts`

Implement both methods of `IAiProvider`. Below is a skeleton for OpenAI:

```typescript
import OpenAI from 'openai'
import type { IAiProvider, ExtractAnswersResult } from '../ai.provider.interface.js'

export class OpenAiProvider implements IAiProvider {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async generateMessage(params: {
    questions: string[]
    maxLength: number
    previousAttempt?: string
  }): Promise<string> {
    const { questions, maxLength, previousAttempt } = params

    const prompt = previousAttempt
      ? `The following message was too long (exceeded ${maxLength} characters). Shorten it while keeping all questions and a friendly tone:\n\n"${previousAttempt}"`
      : [
          `Write a friendly SMS message that includes all of the following questions.`,
          `The message must be under ${maxLength} characters.`,
          `Use a warm, conversational tone — as if a colleague sent it, not a system.`,
          `Do not add greetings with names. Do not use markdown or bullet points.`,
          `Questions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
        ].join('\n')

    const response = await this.client.chat.completions.create({
      model:       'gpt-4o',
      max_tokens:  512,
      messages:    [{ role: 'user', content: prompt }],
    })

    return response.choices[0].message.content?.trim() ?? ''
  }

  async extractAnswers(params: {
    questions: string[]
    messages:  { role: 'ai' | 'participant', body: string }[]
  }): Promise<ExtractAnswersResult> {
    const { questions, messages } = params

    const conversationText = messages
      .map(m => `${m.role === 'ai' ? 'System' : 'Participant'}: ${m.body}`)
      .join('\n')

    const prompt = [
      `You are extracting answers from an SMS conversation.`,
      ``,
      `Questions asked (0-indexed):`,
      questions.map((q, i) => `${i}. ${q}`).join('\n'),
      ``,
      `Conversation:`,
      conversationText,
      ``,
      `Return JSON only, no explanation:`,
      `{`,
      `  "answers": [{ "questionIndex": 0, "answer": "string or null", "confident": true/false }],`,
      `  "followUp": "string or null"`,
      `}`,
      `Rules:`,
      `- answer: null and confident: false if the participant has not answered or is unclear`,
      `- followUp: null if all questions are confidently answered`,
      `- followUp: a friendly rephrased message for any unanswered questions (do not copy originals)`,
      `- Never invent answers`,
    ].join('\n')

    const response = await this.client.chat.completions.create({
      model:           'gpt-4o',
      max_tokens:      1024,
      response_format: { type: 'json_object' },
      messages:        [{ role: 'user', content: prompt }],
    })

    return JSON.parse(response.choices[0].message.content ?? '{}') as ExtractAnswersResult
  }
}
```

### 4. Register the provider in `src/services/ai/ai.factory.ts`

Add one `case` to the switch:

```typescript
case 'openai':
  if (!config.ai) throw new Error('AI_PROVIDER=openai but OPENAI_API_KEY is not set')
  return new OpenAiProvider(config.ai.apiKey)
```

---

## The IAiProvider interface

Every provider must implement exactly these two methods:

```typescript
interface IAiProvider {
  generateMessage(params: {
    questions:       string[]
    maxLength:       number
    previousAttempt?: string
  }): Promise<string>

  extractAnswers(params: {
    questions: string[]
    messages:  { role: 'ai' | 'participant', body: string }[]
  }): Promise<ExtractAnswersResult>
}

type ExtractAnswersResult = {
  answers: {
    questionIndex: number
    answer:        string | null
    confident:     boolean
  }[]
  followUp: string | null
}
```

---

## How the retry loop works (broadcast.service.ts)

The caller handles retries — the provider does not need to retry internally:

```
generateMessage({ questions, maxLength })
  → if length OK → send SMS
  → if too long  → generateMessage({ questions, maxLength, previousAttempt: body })
    → if length OK → send SMS
    → if still too long → SmsTooLongError → Conversation failed
```

Maximum 2 retries before the conversation is marked `failed` with
`failReason = SMS_TOO_LONG`. The provider must always return a string — never
throw for length reasons; let the caller measure and decide.

---

## Before going live

- [ ] Write unit tests for both methods with mocked API responses
- [ ] Test `generateMessage` with a list of 5+ long questions — verify it fits within `maxLength`
- [ ] Test `generateMessage` with `previousAttempt` — verify the shortened version is under the limit
- [ ] Test `extractAnswers` with clear answers — verify all `confident: true` and `followUp: null`
- [ ] Test `extractAnswers` with ambiguous replies — verify `null` answers and a non-null `followUp`
- [ ] Test `extractAnswers` with partial answers — verify only the unanswered questions appear in `followUp`
- [ ] Update `.env.example` with the new provider's env var
- [ ] Update `GET /integrations/status` to reflect the active AI provider
