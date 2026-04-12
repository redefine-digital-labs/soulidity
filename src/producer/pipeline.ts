import type { PrismaClient } from '../db/database.js'
import type { LLMAdapter } from './llm.js'
import { getRoleByName, createProcessLog, updateProcessLog } from '../db/agent-roles.js'
import { insertArticle, updateRawItemStatus, upsertCompany, linkArticleCompany } from '../db/database.js'
import { buildReporterPrompt, parseReporterResponse, REPORTER_SYSTEM_PROMPT } from './agents/reporter.js'
import { buildAnalystPrompt, parseAnalystResponse, ANALYST_SYSTEM_PROMPT } from './agents/analyst.js'
import { buildEditorPrompt, parseEditorResponse, EDITOR_SYSTEM_PROMPT } from './agents/editor.js'
import { getPrismaConnectionErrorCode, isTransientPrismaConnectionError } from '../shared/prisma-errors.js'

interface PipelineResult {
  success: boolean
  articleId: string | null
  error?: string
  retryLater?: boolean
}

function getReviewHint(rawData: string | null): { title?: string; summary?: string } | undefined {
  if (!rawData) return undefined

  try {
    const parsed = JSON.parse(rawData)
    if (!parsed || typeof parsed !== 'object') return undefined

    const review = typeof parsed.review === 'object' && parsed.review !== null ? parsed.review : null
    const title = typeof review?.title === 'string'
      ? review.title
      : typeof parsed.review_title === 'string'
        ? parsed.review_title
        : undefined
    const summary = typeof review?.summary === 'string'
      ? review.summary
      : typeof parsed.review_summary === 'string'
        ? parsed.review_summary
        : undefined

    return title || summary ? { title, summary } : undefined
  } catch {
    return undefined
  }
}

async function requeueRawItem(prisma: PrismaClient, rawItemId: string): Promise<void> {
  await updateRawItemStatus(prisma, rawItemId, 'deduped').catch(() => {})
}

export async function runAgentPipeline(
  prisma: PrismaClient,
  llm: LLMAdapter,
  rawItemId: string,
): Promise<PipelineResult> {
  try {
    const item = await prisma.rawItem.findUnique({ where: { id: rawItemId } })
    if (!item) return { success: false, articleId: null, error: 'Raw item not found' }

    await updateRawItemStatus(prisma, rawItemId, 'processing')

    // --- Reporter phase ---
    const reporterPrompt = buildReporterPrompt(item.title, item.content ?? '', item.sourceName, getReviewHint(item.rawData))
    const reporterRaw = await llm.generate(REPORTER_SYSTEM_PROMPT, reporterPrompt)
    const reporterOutput = parseReporterResponse(reporterRaw)

    // --- Analyst phase ---
    const analystPrompt = buildAnalystPrompt(reporterOutput.title_zh, reporterOutput.lead_zh, item.sourceName)
    const analystRaw = await llm.generate(ANALYST_SYSTEM_PROMPT, analystPrompt)
    const analystOutput = parseAnalystResponse(analystRaw)

    // --- Editor phase ---
    const editorPrompt = buildEditorPrompt(
      reporterOutput.title_zh,
      reporterOutput.lead_zh,
      analystOutput.body_zh,
    )
    const editorRaw = await llm.generate(EDITOR_SYSTEM_PROMPT, editorPrompt)
    const editorOutput = parseEditorResponse(editorRaw)

    // --- Save article (idempotent: skip insert if a previous run already created one) ---
    const status = editorOutput.approved ? 'draft' : 'rejected'
    const existing = await prisma.article.findUnique({ where: { rawItemId } })
    const isReuse = !!existing
    const articleId = existing
      ? existing.id
      : await insertArticle(prisma, {
          raw_item_id: rawItemId,
          title_zh: editorOutput.title_zh,
          title_en: editorOutput.title_zh,
          summary_zh: editorOutput.summary_zh,
          summary_en: editorOutput.summary_zh,
          analysis_zh: editorOutput.analysis_zh,
          analysis_en: null,
          tags: JSON.stringify(analystOutput.tags),
        })

    // Update article pipeline status
    await prisma.article.update({
      where: { id: articleId },
      data: { status, pipelineStatus: 'completed' },
    })

    // Skip side effects on retry reuse — logs and company links were already written on first insert
    if (!isReuse) {
      // --- Write process logs (best-effort, after article exists) ---
      try {
        const [scoutRole, reporterRole, analystRole, editorRole] = await Promise.all([
          getRoleByName(prisma, 'scout'),
          getRoleByName(prisma, 'reporter'),
          getRoleByName(prisma, 'analyst'),
          getRoleByName(prisma, 'editor'),
        ])
        const now = new Date()

        if (scoutRole) {
          const logId = await createProcessLog(prisma, { articleId, roleId: scoutRole.id })
          await updateProcessLog(prisma, logId, {
            status: 'completed',
            output: JSON.stringify({ title: item.title, score: item.score, source: item.sourceName }),
            startedAt: item.createdAt,
            completedAt: now,
          })
        }
        if (reporterRole) {
          const logId = await createProcessLog(prisma, { articleId, roleId: reporterRole.id })
          await updateProcessLog(prisma, logId, { status: 'completed', output: JSON.stringify(reporterOutput), completedAt: now })
        }
        if (analystRole) {
          const logId = await createProcessLog(prisma, { articleId, roleId: analystRole.id })
          await updateProcessLog(prisma, logId, { status: 'completed', output: JSON.stringify(analystOutput), completedAt: now })
        }
        if (editorRole) {
          const logId = await createProcessLog(prisma, { articleId, roleId: editorRole.id })
          await updateProcessLog(prisma, logId, { status: 'completed', output: JSON.stringify(editorOutput), completedAt: now })
        }
      } catch (logErr) {
        console.error('Failed to write process logs:', logErr)
      }

      // Link companies
      if (analystOutput.companies.length) {
        for (const c of analystOutput.companies) {
          try {
            const companyId = await upsertCompany(prisma, c)
            await linkArticleCompany(prisma, articleId, companyId)
          } catch (err) {
            console.error(`Failed to link company ${c.name}:`, err)
          }
        }
      }
    }

    await updateRawItemStatus(prisma, rawItemId, 'produced')

    return { success: true, articleId }
  } catch (err: any) {
    // Retryable: LLM API errors
    const status = err?.status
    if (status === 402 || status === 401 || status === 429) {
      await requeueRawItem(prisma, rawItemId)
      return { success: false, articleId: null, error: `API error ${status}`, retryLater: true }
    }

    // Retryable: transient DB connection errors
    if (isTransientPrismaConnectionError(err)) {
      const pgCode = getPrismaConnectionErrorCode(err) ?? 'unknown'
      console.warn(`Pipeline transient DB error for ${rawItemId}, will retry:`, err.message)
      await requeueRawItem(prisma, rawItemId)
      return { success: false, articleId: null, error: `DB connection error ${pgCode}`, retryLater: true }
    }

    console.error(`Pipeline failed for ${rawItemId}:`, err)
    await updateRawItemStatus(prisma, rawItemId, 'rejected').catch(() => {})
    return { success: false, articleId: null, error: err.message }
  }
}
