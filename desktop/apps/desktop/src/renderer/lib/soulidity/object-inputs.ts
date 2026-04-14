type MultiGetObjectsClient = {
  multiGetObjects: (input: {
    ids: string[]
    options?: { showType?: boolean }
  }) => Promise<Array<{ data?: unknown; error?: { code?: string; error?: string; message?: string } | null }>>
}

function isMissingObjectResponse(response: {
  data?: unknown
  error?: { code?: string; error?: string; message?: string } | null
}) {
  if (!response.data) {
    return true
  }

  const errorCode = response.error?.code ?? ''
  const errorMessage = [response.error?.error, response.error?.message, errorCode].filter(Boolean).join(' ')
  return /not.?exist|not.?found|requested entity was not found/i.test(errorMessage)
}

export async function findMissingObjectIds(
  client: MultiGetObjectsClient,
  objectIds: Array<string | null | undefined>,
) {
  const ids = [...new Set(objectIds.filter((value): value is string => !!value && value.trim().length > 0))]
  if (ids.length === 0) {
    return []
  }

  const responses = await client.multiGetObjects({
    ids,
    options: { showType: true },
  })

  return responses.flatMap((response, index) => {
    const objectId = ids[index]
    if (!objectId || !isMissingObjectResponse(response)) {
      return []
    }

    return [objectId]
  })
}

export async function assertObjectInputsExist(
  client: MultiGetObjectsClient,
  labeledObjectIds: Record<string, string | null | undefined>,
) {
  const entries = Object.entries(labeledObjectIds)
    .map(([label, objectId]) => [label, objectId?.trim() ?? ''] as const)
    .filter(([, objectId]) => objectId.length > 0)

  if (entries.length === 0) {
    return
  }

  const missingIds = await findMissingObjectIds(
    client,
    entries.map(([, objectId]) => objectId),
  )
  if (missingIds.length === 0) {
    return
  }

  const labelById = new Map(entries.map(([label, objectId]) => [objectId, label]))
  const missingLabels = [...new Set(missingIds.map((objectId) => labelById.get(objectId) ?? 'Required object'))]

  if (missingLabels.length === 1) {
    throw new Error(`${missingLabels[0]} is no longer available on-chain. Refresh the page and try again.`)
  }

  throw new Error(`${missingLabels.join(', ')} are no longer available on-chain. Refresh the page and try again.`)
}
