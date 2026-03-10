export function resolveArticleStatusFilter(
  requestedStatus: string | null,
  isAdmin: boolean,
): { allowed: boolean; status: string | null } {
  if (isAdmin) {
    return { allowed: true, status: requestedStatus }
  }

  if (!requestedStatus) {
    return { allowed: true, status: 'published' }
  }

  if (requestedStatus !== 'published') {
    return { allowed: false, status: null }
  }

  return { allowed: true, status: 'published' }
}
