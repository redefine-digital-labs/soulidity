/** Build-time projection only. Production must not fall back to local files. */
export function staticPublicEnvironment(
  processValues: Record<string, string | undefined>,
  readLocal: () => Record<string, string>,
): Record<string, string> {
  const local = processValues.CLAWNEWS_LOAD_ENV_LOCAL === 'false' || processValues.VERCEL_ENV
    ? {} : readLocal()
  return Object.fromEntries(Object.entries({ ...local, ...processValues })
    .filter((entry): entry is [string, string] => entry[0].startsWith('NEXT_PUBLIC_') && typeof entry[1] === 'string'))
}
