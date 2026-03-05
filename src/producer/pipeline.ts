import type { PrismaClient } from '../db/database.js'
import type { LLMAdapter } from './llm.js'
import { getRoleByName, createProcessLog, updateProcessLog } from '../db/agent-roles.js'
import { insertArticle, updateRawItemStatus, upsertCompany, linkArticleCompany } from '../db/database.js'
import { buildReporterPrompt, parseReporterResponse, REPORTER_SYSTEM_PROMPT } from './agents/reporter.js'
import { buildAnalystPrompt, parseAnalystResponse, ANALYST_SYSTEM_PROMPT } from './agents/analyst.js'
import { buildEditorPrompt, parseEditorResponse, EDITOR_SYSTEM_PROMPT } from './agents/editor.js'

interface PipelineResult {
  success: boolean
  articleId: string | null
  error?: string
}

export async function runAgentPipeline(
  prisma: PrismaClient,
  llm: LLMAdapter,
  rawItemId: string,
): Promise<PipelineResult> {
  const item = await prisma.rawItem.findUnique({ where: { id: rawItemId } })
  if (!item) return { success: false, articleId: null, error: 'Raw item not found' }

  try {
    // --- Scout phase (already done by collector, just log it) ---
    const scoutRole = await getRoleByName(prisma, 'scout')
    if (scoutRole) {
      const logId = await createProcessLog(prisma, { articleId: rawItemId, roleId: scoutRole.id })
      await updateProcessLog(prisma, logId, {
        status: 'completed',
        output: JSON.stringify({ title: item.title, score: item.score, source: item.sourceName }),
        startedAt: item.createdAt,
        completedAt: new Date(),
      })
    }

    await updateRawItemStatus(prisma, rawItemId, 'processing')

    // --- Reporter phase ---
    const reporterRole = await getRoleByName(prisma, 'reporter')
    const reporterLogId = reporterRole ? await createProcessLog(prisma, { articleId: rawItemId, roleId: reporterRole.id }) : null
    if (reporterLogId) await updateProcessLog(prisma, reporterLogId, { status: 'running', startedAt: new Date() })

    const reporterPrompt = buildReporterPrompt(item.title, item.content ?? '', item.sourceName)
    const reporterRaw = await llm.generate(REPORTER_SYSTEM_PROMPT, reporterPrompt)
    const reporterOutput = parseReporterResponse(reporterRaw)

    if (reporterLogId) await updateProcessLog(prisma, reporterLogId, {
      status: 'completed',
      output: JSON.stringify(reporterOutput),
      completedAt: new Date(),
    })

    // --- Analyst phase ---
    const analystRole = await getRoleByName(prisma, 'analyst')
    const analystLogId = analystRole ? await createProcessLog(prisma, { articleId: rawItemId, roleId: analystRole.id }) : null
    if (analystLogId) await updateProcessLog(prisma, analystLogId, { status: 'running', startedAt: new Date() })

    const analystPrompt = buildAnalystPrompt(reporterOutput.title_zh, reporterOutput.lead_zh, item.sourceName)
    const analystRaw = await llm.generate(ANALYST_SYSTEM_PROMPT, analystPrompt)
    const analystOutput = parseAnalystResponse(analystRaw)

    if (analystLogId) await updateProcessLog(prisma, analystLogId, {
      status: 'completed',
      output: JSON.stringify(analystOutput),
      completedAt: new Date(),
    })

    // --- Editor phase ---
    const editorRole = await getRoleByName(prisma, 'editor')
    const editorLogId = editorRole ? await createProcessLog(prisma, { articleId: rawItemId, roleId: editorRole.id }) : null
    if (editorLogId) await updateProcessLog(prisma, editorLogId, { status: 'running', startedAt: new Date() })

    const editorPrompt = buildEditorPrompt(
      reporterOutput.title_zh,
      reporterOutput.lead_zh,
      analystOutput.body_zh,
    )
    const editorRaw = await llm.generate(EDITOR_SYSTEM_PROMPT, editorPrompt)
    const editorOutput = parseEditorResponse(editorRaw)

    if (editorLogId) await updateProcessLog(prisma, editorLogId, {
      status: 'completed',
      output: JSON.stringify(editorOutput),
      completedAt: new Date(),
    })

    // --- Save article ---
    const status = editorOutput.approved ? 'draft' : 'rejected'
    const articleId = await insertArticle(prisma, {
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

    await updateRawItemStatus(prisma, rawItemId, 'produced')

    return { success: true, articleId }
  } catch (err: any) {
    const status = err?.status
    if (status === 402 || status === 401 || status === 429) {
      await updateRawItemStatus(prisma, rawItemId, 'deduped')
      return { success: false, articleId: null, error: `API error ${status}` }
    }
    console.error(`Pipeline failed for ${rawItemId}:`, err)
    await updateRawItemStatus(prisma, rawItemId, 'rejected')
    return { success: false, articleId: null, error: err.message }
  }
}
