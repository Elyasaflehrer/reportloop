import { config } from '../../config.js'
import type { IAiProvider } from './ai.provider.interface.js'
import { AnthropicProvider } from './providers/anthropic.provider.js'

export function createAiProvider(): IAiProvider {
  if (!config.ai) throw new Error('AI provider is not configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY')

  switch (config.ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.ai.apiKey)
    // future: case 'openai': return new OpenAiProvider(config.ai.apiKey)
    default:
      throw new Error(`Unknown AI_PROVIDER: "${config.ai.provider}"`)
  }
}
