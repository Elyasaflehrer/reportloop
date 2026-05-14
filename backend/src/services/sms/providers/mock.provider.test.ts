import { describe, it, expect } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { MockSmsProvider } from './mock.provider.js'

// Helper — builds a minimal FastifyRequest stub. parseWebhook only reads
// `req.body`, so the cast is safe; everything else is irrelevant.
function fakeReq(body: Record<string, string>): FastifyRequest {
  return { body } as unknown as FastifyRequest
}

describe('MockSmsProvider.parseWebhook', () => {
  it('returns an inbound event for a participant-style payload', () => {
    const provider = new MockSmsProvider()
    const req = fakeReq({
      from:      '+15551234567',
      to:        '+15559876543',
      body:      'hi there',
      messageId: 'MOCKMSG000001',
    })

    const result = provider.parseWebhook(req)
    console.log({ input: req.body, result })

    expect(result.type).toBe('inbound')
    // After narrowing on type, the inbound-only fields are accessible.
    expect(result).toEqual({
      type:      'inbound',
      from:      '+15551234567',
      to:        '+15559876543',
      body:      'hi there',
      messageId: 'MOCKMSG000001',
      segments:  1,    // mock defaults segments to 1 when not provided
      numMedia:  0,
    })
  })

  it('returns a status event when the payload has a status field', () => {
    const provider = new MockSmsProvider()
    const req = fakeReq({
      from:      '+15551234567',
      to:        '+15559876543',
      messageId: 'MOCKMSG000002',
      status:    'delivered',
    })

    const result = provider.parseWebhook(req)
    console.log({ input: req.body, result })

    expect(result.type).toBe('status')
    expect(result).toEqual({
      type:         'status',
      from:         '+15551234567',
      to:           '+15559876543',
      messageId:    'MOCKMSG000002',
      status:       'delivered',
      segments:     1,
      errorCode:    undefined,
      errorMessage: undefined,
    })
  })

  it('propagates errorCode and errorMessage on a failed status', () => {
    const provider = new MockSmsProvider()
    const req = fakeReq({
      from:         '+15551234567',
      to:           '+15559876543',
      messageId:    'MOCKMSG000003',
      status:       'failed',
      errorCode:    '30007',
      errorMessage: 'Carrier rejected message',
    })

    const result = provider.parseWebhook(req)
    console.log({ input: req.body, result })

    expect(result.type).toBe('status')
    if (result.type !== 'status') throw new Error('narrow failed')
    expect(result.errorCode).toBe('30007')
    expect(result.errorMessage).toBe('Carrier rejected message')
  })

  it('collapses empty-string error fields to undefined on a success status', () => {
    // Real providers sometimes send empty errorCode/errorMessage on success.
    // We rely on the `|| undefined` pattern in parseWebhook so that
    // `result.errorCode != null` actually means "there was an error".
    const provider = new MockSmsProvider()
    const req = fakeReq({
      from:         '+15551234567',
      to:           '+15559876543',
      messageId:    'MOCKMSG000004',
      status:       'delivered',
      errorCode:    '',
      errorMessage: '',
    })

    const result = provider.parseWebhook(req)
    console.log({ input: req.body, result })

    if (result.type !== 'status') throw new Error('narrow failed')
    expect(result.errorCode).toBeUndefined()
    expect(result.errorMessage).toBeUndefined()
  })

  it('falls back to empty strings / zeros for missing fields', () => {
    const provider = new MockSmsProvider()
    const req = fakeReq({})

    const result = provider.parseWebhook(req)
    console.log({ input: req.body, result })

    // Empty body has no `status` field → treated as inbound.
    expect(result).toEqual({
      type:      'inbound',
      from:      '',
      to:        '',
      body:      '',
      messageId: '',
      segments:  1,    // defaults to 1 from `?? '1'`
      numMedia:  0,    // defaults to 0 from `?? '0'`
    })
  })

  it('parses numMedia and segments as numbers, not strings', () => {
    const provider = new MockSmsProvider()
    const req = fakeReq({
      from:      '+15551234567',
      to:        '+15559876543',
      body:      'multi-segment SMS with picture',
      messageId: 'MOCKMSG000005',
      segments:  '3',
      numMedia:  '1',
    })

    const result = provider.parseWebhook(req)
    console.log({ input: req.body, result })

    if (result.type !== 'inbound') throw new Error('narrow failed')
    // String '3' from the wire becomes number 3 in the WebhookEvent.
    expect(result.segments).toBe(3)
    expect(typeof result.segments).toBe('number')
    expect(result.numMedia).toBe(1)
    expect(typeof result.numMedia).toBe('number')
  })
})
