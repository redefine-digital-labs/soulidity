import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({}))
const mockedProcessJoinRequest = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@bot/gateway', () => ({
  processJoinRequest: mockedProcessJoinRequest,
}))

vi.mock('@shared/app-config', () => ({
  getAppBaseUrl: () => 'https://clawnews.test',
}))

describe('POST /api/join', () => {
  const originalBotToken = process.env.TG_BOT_TOKEN
  const originalGroupId = process.env.TG_GROUP_ID

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.TG_BOT_TOKEN = 'bot-token'
    process.env.TG_GROUP_ID = '-100123'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalBotToken === undefined) {
      delete process.env.TG_BOT_TOKEN
    } else {
      process.env.TG_BOT_TOKEN = originalBotToken
    }
    if (originalGroupId === undefined) {
      delete process.env.TG_GROUP_ID
    } else {
      process.env.TG_GROUP_ID = originalGroupId
    }
  })

  it('logs Telegram API failures without dumping the full response payload', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        ok: false,
        error_code: 400,
        description: 'Bad Request: invite expired',
        result: { invite_link: 'https://t.me/+secret' },
      }),
    }))
    mockedProcessJoinRequest.mockImplementation(async (_prisma: unknown, req: { createInviteLink: () => Promise<string> }) => {
      try {
        await req.createInviteLink()
      } catch {
        // Ignore the expected Telegram failure; the route should sanitize the log first.
      }

      return { success: false, error: 'Failed to create invite link', error_code: 'LINK_FAILED' }
    })

    const { POST } = await import('../../web/app/api/join/route.ts')
    const response = await POST(new Request('http://localhost/api/join', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tg_id: '123456', invite_code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Failed to create invite link',
    })
    expect(consoleError).toHaveBeenNthCalledWith(1, '[join] Telegram API error:', {
      description: 'Bad Request: invite expired',
      error_code: 400,
    })

    consoleError.mockRestore()
  })
})
