export interface IAiProvider {
  generateMessage(params: {
    questions:        string[]
    maxLength:        number
    previousAttempt?: string  // if set: previous message was too long — shorten it
  }): Promise<string>

  extractAnswers(params: {
    questions: string[]
    messages:  { role: 'ai' | 'participant', body: string }[]
  }): Promise<ExtractAnswersResult>
}

export type ExtractAnswersResult = {
  answers: {
    questionIndex: number
    answer:        string | null
    confident:     boolean
  }[]
  followUp: string | null  // null = all answered; string = send this and await next reply
}
