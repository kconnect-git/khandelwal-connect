import { useEffect, useRef, useState } from 'react'
import {
  MAX_MATRIMONY_PHOTOS,
  removeMatrimonyPhoto,
  setMainMatrimonyPhoto,
  signedPhotoUrls,
  uploadMatrimonyPhoto,
} from '../../lib/matrimony'
import type { MatrimonyPhoto } from '../../types/database'

// Phase 6a: the owner's 0-3 matrimony photos. Each change goes straight to
// the server (no Save needed), then the parent reloads.

type MatrimonyPhotoManagerProps = {
  photos: MatrimonyPhoto[]
  disabled?: boolean
  onChanged: () => Promise<void> | void
}

export function MatrimonyPhotoManager({ photos, disabled, onChanged }: MatrimonyPhotoManagerProps) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pathsKey = photos.map((photo) => photo.storage_path).join('|')
  useEffect(() => {
    let cancelled = false
    const paths = pathsKey ? pathsKey.split('|') : []
    signedPhotoUrls(paths)
      .then((next) => {
        if (!cancelled) setUrls(next)
      })
      .catch((err) => console.error('[MatrimonyPhotoManager] failed to sign URLs', err))
    return () => {
      cancelled = true
    }
  }, [pathsKey])

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const canAdd = photos.length < MAX_MATRIMONY_PHOTOS && !disabled

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-3 gap-3">
        {photos.map((photo) => (
          <li key={photo.id} className="flex flex-col gap-1.5">
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              {urls[photo.storage_path] && (
                <img
                  src={urls[photo.storage_path]}
                  alt={photo.position === 1 ? 'Main photo' : `Photo ${photo.position}`}
                  className="h-full w-full object-cover"
                />
              )}
              {photo.position === 1 && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                  Main
                </span>
              )}
            </div>
            {!disabled && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {photo.position !== 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => setMainMatrimonyPhoto(photo.id), 'Could not change the main photo.')
                    }
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
                  >
                    Make main
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removeMatrimonyPhoto(photo.id), 'Could not remove the photo.')}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
        {canAdd && (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-[3/4] w-full items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
            >
              {busy ? 'Working…' : '+ Add photo'}
            </button>
          </li>
        )}
      </ul>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) run(() => uploadMatrimonyPhoto(file), 'Something went wrong uploading the photo.')
        }}
      />
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
    </div>
  )
}
