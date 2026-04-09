import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SKILL_BUNDLE_FRONTMATTER_EXAMPLE,
  validateSelectedSkillBundle,
} from '@/lib/soulidity/upload-validation'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function decodeBase64(base64: string) {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

function createMockFile(name: string, type: string, bytes: Uint8Array) {
  return {
    name,
    type,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.slice().buffer
    },
  } as Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>
}

const MISSING_SKILL_MD_ZIP = decodeBase64(
  'UEsDBAoAAAAAADCeh1wZ9sQ7EAAAABAAAAAJABwAUkVBRE1FLm1kVVQJAANL79RpS+/UaXV4CwABBPUBAAAEFAAAACMgTWlzc2luZyBTS0lMTApQSwECHgMKAAAAAAAwnodcGfbEOxAAAAAQAAAACQAYAAAAAAABAAAApIEAAAAAUkVBRE1FLm1kVVQFAANL79RpdXgLAAEE9QEAAAQUAAAAUEsFBgAAAAABAAEATwAAAFMAAAAAAA==',
)

const MISSING_NAME_ZIP = decodeBase64(
  'UEsDBAoAAAAAADCeh1z+ryGPMQAAADEAAAAIABwAU0tJTEwubWRVVAkAA0vv1GlL79RpdXgLAAEE9QEAAAQUAAAALS0tCmRlc2NyaXB0aW9uOiBNaXNzaW5nIG5hbWUKLS0tCiMgQnJva2VuIFNraWxsClBLAQIeAwoAAAAAADCeh1z+ryGPMQAAADEAAAAIABgAAAAAAAEAAACkgQAAAABTS0lMTC5tZFVUBQADS+/UaXV4CwABBPUBAAAEFAAAAFBLBQYAAAAAAQABAE4AAABzAAAAAAA=',
)

const VALID_SKILL_ZIP = decodeBase64(
  'UEsDBBQAAAAIADCeh1zBz60TTQAAAFgAAAAIABwAU0tJTEwubWRVVAkAA0vv1GlL79RpdXgLAAEE9QEAAAQUAAAA09XV5cpLzE21UshNLMpOLdEtTs4vLeFKSS1OLsosKMnMz7NSCClKTM4uVijLz0ksycxJhapUKC4pKk0uKS1K5dIFGqKs4AsRDgYbAABQSwECHgMUAAAACAAwnodcwc+tE00AAABYAAAACAAYAAAAAAABAAAApIEAAAAAU0tJTEwubWRVVAUAA0vv1Gl1eAsAAQT1AQAABBQAAABQSwUGAAAAAAEAAQBOAAAAjwAAAAAA',
)

const NESTED_SKILL_ZIP = decodeBase64(
  'UEsDBAoAAAAAAOOih1wAAAAAAAAAAAAAAAANABwAbWFya2V0LXNjb3V0L1VUCQADKvfUaSr31Gl1eAsAAQT1AQAABBQAAABQSwMEFAAAAAgA46KHXMHPrRNNAAAAWAAAABUAHABtYXJrZXQtc2NvdXQvU0tJTEwubWRVVAkAAyr31Gkq99RpdXgLAAEE9QEAAAQUAAAA09XV5cpLzE21UshNLMpOLdEtTs4vLeFKSS1OLsosKMnMz7NSCClKTM4uVijLz0ksycxJhapUKC4pKk0uKS1K5dIFGqKs4AsRDgYbAABQSwECHgMKAAAAAADjoodcAAAAAAAAAAAAAAAADQAYAAAAAAAAABAA7UEAAAAAbWFya2V0LXNjb3V0L1VUBQADKvfUaXV4CwABBPUBAAAEFAAAAFBLAQIeAxQAAAAIAOOih1zBz60TTQAAAFgAAAAVABgAAAAAAAEAAACkgUcAAABtYXJrZXQtc2NvdXQvU0tJTEwubWRVVAUAAyr31Gl1eAsAAQT1AQAABBQAAABQSwUGAAAAAAIAAgCuAAAA4wAAAAAA',
)

describe('client skill bundle validation', () => {
  it('explains the specific format problem before upload starts', async () => {
    const notZip = await validateSelectedSkillBundle(
      createMockFile('skills.txt', 'text/plain', new TextEncoder().encode('not a zip')),
    )
    expect(notZip).toEqual({
      ok: false,
      error: "Can't use this file. Upload a .zip file for Skills & Docs.",
    })

    const missingSkillMd = await validateSelectedSkillBundle(
      createMockFile('skills.zip', 'application/zip', MISSING_SKILL_MD_ZIP),
    )
    expect(missingSkillMd).toEqual({
      ok: false,
      error: "Can't use this ZIP file. Put SKILL.md at the ZIP root or inside one folder, then upload it again.",
    })

    const missingName = await validateSelectedSkillBundle(
      createMockFile('skills.zip', 'application/zip', MISSING_NAME_ZIP),
    )
    expect(missingName).toEqual({
      ok: false,
      error: "Can't use this ZIP file. SKILL.md must start with frontmatter and include name.",
    })
  })

  it('accepts a valid zip bundle and exposes the parsed skill name', async () => {
    const result = await validateSelectedSkillBundle(
      createMockFile('skills.zip', 'application/zip', VALID_SKILL_ZIP),
    )

    expect(result).toEqual({
      ok: true,
      skillName: 'market-scout',
    })
  })

  it('accepts SKILL.md at the zip root or inside a single top-level folder', async () => {
    const nested = await validateSelectedSkillBundle(
      createMockFile('skills.zip', 'application/zip', NESTED_SKILL_ZIP),
    )

    expect(nested).toEqual({
      ok: true,
      skillName: 'market-scout',
    })
  })

  it('ships the correct SKILL.md frontmatter example for upload guidance', () => {
    expect(SKILL_BUNDLE_FRONTMATTER_EXAMPLE).toContain('---')
    expect(SKILL_BUNDLE_FRONTMATTER_EXAMPLE).toContain('name: market-scout')
    expect(SKILL_BUNDLE_FRONTMATTER_EXAMPLE).toContain('# Market Scout')
  })

  it('keeps immediate skill bundle validation wired into every skills upload entrypoint', () => {
    const createSource = readSource('web/app/create/content/page.tsx')
    const importSource = readSource('web/app/import/map/page.tsx')
    const wrapSource = readSource('web/app/wrap-link/personal/configure/page.tsx')
    const skillsPanelSource = readSource('web/components/souls/skills-panel.tsx')
    const hintSource = readSource('web/components/souls/skill-bundle-format-hint.tsx')
    const validationSource = readSource('web/lib/soulidity/upload-validation.ts')

    expect(createSource).toContain('validateSelectedSkillBundle')
    expect(createSource).toContain('<SkillBundleFormatHint')

    expect(importSource).toContain('validateSelectedSkillBundle')
    expect(importSource).toContain('<SkillBundleFormatHint')

    expect(wrapSource).toContain('validateSelectedSkillBundle')
    expect(wrapSource).toContain('<SkillBundleFormatHint')

    expect(skillsPanelSource).toContain('validateSelectedSkillBundle')
    expect(skillsPanelSource).toContain('<SkillBundleFormatHint')

    expect(validationSource).toContain('root or inside one folder')
    expect(hintSource).toContain('Download template')
  })
})
