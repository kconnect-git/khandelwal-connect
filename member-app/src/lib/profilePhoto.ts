import { supabase } from '../utils/supabase'
import { updateOwnPerson } from './people'
import type { Person } from '../types/database'

const BUCKET = 'profile-photos'
const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.85

// Re-encoding through a canvas both caps the file size (max 1600px long
// edge, per the upload plan in the project context doc) and drops all EXIF
// metadata -- phones embed GPS coordinates in photos, which must not end up
// on a public-read bucket.
async function compressImage(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('That file could not be read as an image.'))
      img.src = objectUrl
    })

    const scale = Math.min(1, MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process the image in this browser.')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) throw new Error('Could not process the image in this browser.')
    return blob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// The public URL getPublicUrl() hands out looks like
// <supabase-url>/storage/v1/object/public/profile-photos/<path> -- recover
// <path> so an old photo can be deleted when a new one replaces it.
function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/${BUCKET}/`
  const index = url.indexOf(marker)
  if (index === -1) return null
  return decodeURIComponent(url.slice(index + marker.length))
}

async function deleteStoredPhoto(publicUrl: string): Promise<void> {
  const path = storagePathFromPublicUrl(publicUrl)
  if (!path) return
  // Best-effort: an orphaned old file is not worth failing the whole
  // operation over.
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.warn('[profilePhoto] failed to remove old photo', error)
}

export async function uploadProfilePhoto(
  file: File,
  authUserId: string,
  person: Person,
): Promise<Person> {
  const blob = await compressImage(file)

  // Timestamped filename: every upload is a fresh object, so the public URL
  // changes and no <img> cache needs busting.
  const path = `${authUserId}/profile-${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const updated = await updateOwnPerson(person.id, { profile_photo_url: data.publicUrl })

  if (person.profile_photo_url) await deleteStoredPhoto(person.profile_photo_url)
  return updated
}

export async function removeProfilePhoto(person: Person): Promise<Person> {
  const updated = await updateOwnPerson(person.id, { profile_photo_url: null })
  if (person.profile_photo_url) await deleteStoredPhoto(person.profile_photo_url)
  return updated
}
