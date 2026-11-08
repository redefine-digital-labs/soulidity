/** Some SDK methods/transports ignore their signal. Bound the caller, observe
 * late failures and never publish a late result after wallet cancellation. */
export async function profileReadStep<T>(signal: AbortSignal, run: () => PromiseLike<T>, discard?: (value: T) => void): Promise<T> {
  signal.throwIfAborted()
  let cancel: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
  })
  try {
    return await Promise.race([aborted, Promise.resolve().then(() => {
      signal.throwIfAborted(); return run()
    }).then(value => {
      if (signal.aborted) { discard?.(value); signal.throwIfAborted() }
      return value
    })])
  } finally { signal.removeEventListener('abort', cancel) }
}
