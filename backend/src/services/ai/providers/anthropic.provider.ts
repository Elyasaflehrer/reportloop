import Anthropic from '@anthropic-ai/sdk'
import type { IAiProvider, ExtractAnswersResult } from '../ai.provider.interface.js'

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
      ? [
          `The following SMS message is too long (exceeds ${maxLength} characters).`,
          `Shorten it while keeping all the questions and the same friendly tone.`,
          `Return only the shortened message — no explanation.`,
          ``,
          `Original message:`,
          previousAttempt,
        ].join('\n')
      : [
          `Write a friendly SMS message that includes all of the following questions.`,
          `The message must be under ${maxLength} characters.`,
          `Use a warm, conversational tone — as if a colleague sent it, not a system.`,
          `Do not include any names or greetings. Do not use markdown or bullet points.`,
          `Return only the message text — no explanation, no quotes.`,
          ``,
          `Questions:`,
          questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
        ].join('\n')

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

    const conversationText = messages
      .map(m => `${m.role === 'ai' ? 'System' : 'Participant'}: ${m.body}`)
      .join('\n')

    const prompt = [
      `You are extracting answers from an SMS conversation between a system and a participant.`,
      ``,
      `Questions (0-indexed):`,
      questions.map((q, i) => `${i}. ${q}`).join('\n'),
      ``,
      `Conversation:`,
      conversationText,
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
