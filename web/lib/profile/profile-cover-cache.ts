export interface ProfileCoverCache {
  read(key: string): Promise<File | null>
  write(key: string, file: File): Promise<void>
}

/** Staging bytes for the already-public cropped cover, never private account
 * state. Its hash is checked against the frozen draft before every upload. */
export function browserProfileCoverCache(): ProfileCoverCache {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('PROFILE_COVER_RECOVERY_STORAGE_UNAVAILABLE')); return }
      const request = indexedDB.open('soulidity-public-profile-covers', 1)
      let failed = false
      request.onupgradeneeded = () => request.result.createObjectStore('covers')
      request.onerror = () => reject(new Error('PROFILE_COVER_RECOVERY_STORAGE_UNAVAILABLE', { cause: request.error }))
      request.onblocked = () => { failed = true; reject(new Error('PROFILE_COVER_RECOVERY_STORAGE_BLOCKED')) }
      request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result) }
    })
  }
  async function read(key: string) {
    const db = await open()
    try {
      return await new Promise<File | null>((resolve, reject) => {
        const tx = db.transaction('covers', 'readonly'), request = tx.objectStore('covers').get(key)
        tx.oncomplete = () => {
          const value = request.result
          if (value === undefined) { resolve(null); return }
          if (!(value instanceof Blob) || value.size < 1 || value.size > 10 * 1024 * 1024
            || !['image/png', 'image/jpeg', 'image/webp'].includes(value.type)) {
            reject(new Error('PROFILE_COVER_RECOVERY_BYTES_INVALID')); return
          }
          const extension = value.type === 'image/jpeg' ? 'jpg' : value.type === 'image/webp' ? 'webp' : 'png'
          resolve(new File([value], `profile-cover.${extension}`, { type: value.type }))
        }
        tx.onabort = () => reject(new Error('PROFILE_COVER_RECOVERY_READ_FAILED', { cause: tx.error }))
      })
    } finally { db.close() }
  }
  return {
    read,
    async write(key, file) {
      const db = await open()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('covers', 'readwrite', { durability: 'strict' })
          tx.objectStore('covers').put(file, key)
          tx.oncomplete = () => resolve()
          tx.onabort = () => reject(new Error('PROFILE_COVER_RECOVERY_WRITE_FAILED', { cause: tx.error }))
        })
      } finally { db.close() }
    },
  }
}
