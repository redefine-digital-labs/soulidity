/**
 * ImageProvider — 统一抽象：输入参考图 + 提示词，输出 N 张 PNG buffer。
 *
 * 当前内置 adapter：
 *   - openai  : OpenAI gpt-image-1  (env: OPENAI_API_KEY)
 *   - gemini  : Google Gemini 2.5 Flash Image / Nano Banana  (env: GEMINI_API_KEY)
 *
 * 加新 provider：实现 ImageProvider 接口并在 createProvider 注册。
 */

import { readFileSync } from 'node:fs'

export interface GenerateRequest {
  prompt: string
  referenceImagePath: string
  /** 生成张数。两阶段 A-1 传 7，两阶段 A-2 传 8，一次性传 1。 */
  count: number
  /** 单张尺寸。默认 1024（多数模型不支持 512 原生，需后期 resize）。 */
  size?: number
}

export interface GenerateResult {
  images: Buffer[]
}

export interface ImageProvider {
  readonly name: string
  generate(req: GenerateRequest): Promise<GenerateResult>
}

// ---------- OpenAI gpt-image-1 ----------

class OpenAIProvider implements ImageProvider {
  readonly name = 'openai'
  constructor(private readonly apiKey: string) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const { prompt, referenceImagePath, count, size = 1024 } = req
    const imageBuf = readFileSync(referenceImagePath)

    const form = new FormData()
    form.append('model', 'gpt-image-1')
    form.append('prompt', prompt)
    form.append('n', String(count))
    form.append('size', `${size}x${size}`)
    form.append('image', new Blob([imageBuf], { type: 'image/png' }), 'reference.png')
    form.append('background', 'transparent')

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`OpenAI ${res.status}: ${errText}`)
    }

    const body = (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> }
    const images: Buffer[] = []
    for (const item of body.data) {
      if (item.b64_json) {
        images.push(Buffer.from(item.b64_json, 'base64'))
      } else if (item.url) {
        const r = await fetch(item.url)
        images.push(Buffer.from(await r.arrayBuffer()))
      }
    }
    return { images }
  }
}

// ---------- Gemini 2.5 Flash Image (Nano Banana) ----------

class GeminiProvider implements ImageProvider {
  readonly name = 'gemini'
  constructor(private readonly apiKey: string) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const { prompt, referenceImagePath, count } = req
    const imageBuf = readFileSync(referenceImagePath)
    const images: Buffer[] = []

    // Gemini 单次只返 1 张，循环调用。
    for (let i = 0; i < count; i++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: 'image/png', data: imageBuf.toString('base64') } },
                ],
              },
            ],
            generationConfig: { responseModalities: ['IMAGE'] },
          }),
        },
      )

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Gemini ${res.status}: ${errText}`)
      }

      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inline_data?: { data: string } }> } }>
      }
      const part = body.candidates?.[0]?.content?.parts?.find(p => p.inline_data)
      if (!part?.inline_data?.data) {
        throw new Error(`Gemini returned no image (iteration ${i + 1}/${count})`)
      }
      images.push(Buffer.from(part.inline_data.data, 'base64'))
    }

    return { images }
  }
}

// ---------- Factory ----------

export type ProviderName = 'openai' | 'gemini'

export function createProvider(name: ProviderName): ImageProvider {
  switch (name) {
    case 'openai': {
      const key = process.env.OPENAI_API_KEY
      if (!key) throw new Error('OPENAI_API_KEY env var not set')
      return new OpenAIProvider(key)
    }
    case 'gemini': {
      const key = process.env.GEMINI_API_KEY
      if (!key) throw new Error('GEMINI_API_KEY env var not set')
      return new GeminiProvider(key)
    }
    default:
      throw new Error(`Unknown provider: ${name}. Supported: openai, gemini`)
  }
}
