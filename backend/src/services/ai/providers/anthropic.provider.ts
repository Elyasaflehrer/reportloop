import Anthropic from '@anthropic-ai/sdk'
import type { IAiProvider, ExtractAnswersResult } from '../ai.provider.interface.js'
import { prompts, renderPrompt } from '../prompts.js'

export class AnthropicProvider implements IAiProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async generateMessage(params: {
    questions:        string[]
    maxLength:        number
    previousAttempt?: string
  }): Promise<string> {
    const { questions, maxLength, previousAttempt } = params

    const prompt = previousAttempt
      ? renderPrompt(prompts.shorten, {
          maxLength:       String(maxLength),
          previousAttempt,
        })
      : renderPrompt(prompts.initial, {
          maxLength: String(maxLength),
          questions: questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
        })

    const response = await this.client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    })

    const block = response.content[0]
    return block.type === 'text' ? block.text.trim() : ''
  }

  async extractAnswers(params: {
    questions: string[]
    messages:  { role: 'ai' | 'participant', body: string }[]
  }): Promise<ExtractAnswersResult> {
    const { questions, messages } = params

    const conversation = messages
      .map(m => `${m.role === 'ai' ? 'System' : 'Participant'}: ${m.body}`)
      .join('\n')

    const prompt = renderPrompt(prompts.extract, {
      questions: questions.map((q, i) => `${i}. ${q}`).join('\n'),
      conversation,
    })

    const response = await this.client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    })

    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected AI response type')

    const text = block.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    return JSON.parse(text) as ExtractAnswersResult
  }
}
