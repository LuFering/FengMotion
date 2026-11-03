/** Media timestamps use seconds, without assuming a frame rate for arbitrary video files. */
export function formatMediaTime(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000))
  const minutes = Math.floor(millis / 60000)
  const wholeSeconds = Math.floor(millis / 1000) % 60
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(millis % 1000).padStart(3, '0')}`
}

/** The actual picture rectangle inside an object-fit:contain element, excluding letterboxing. */
export function containedMediaRect(box: { left: number; top: number; width: number; height: number }, naturalWidth: number, naturalHeight: number) {
  if (box.width <= 0 || box.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height }
}
