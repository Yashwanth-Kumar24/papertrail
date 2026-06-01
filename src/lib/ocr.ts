export type OcrProgressCallback = (pct: number, status: string) => void

export async function recognizeReceipt(
  source: File | string,
  onProgress?: OcrProgressCallback
): Promise<string> {
  const useGoogle = process.env.NEXT_PUBLIC_USE_GOOGLE_OCR === 'true'

  if (useGoogle) {
    onProgress?.(20, 'encoding')
    const base64 = await toBase64(source)
    onProgress?.(50, 'reading with Google Vision')

    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    })

    if (!res.ok) throw new Error('Google Vision failed')
    const data = await res.json()
    if (data.error) throw new Error(data.error)

    onProgress?.(100, 'done')
    return data.text
  }

  // Only reaches here if NEXT_PUBLIC_USE_GOOGLE_OCR is false
  onProgress?.(0, 'loading')
  const Tesseract = (await import('tesseract.js')).default
  const input = source instanceof File ? await preprocessImage(source) : source

  const result = await Tesseract.recognize(input, 'eng', {
    logger: (m: { status: string; progress: number }) => {
      if (onProgress && m.status === 'recognizing text') {
        onProgress(Math.round(m.progress * 100), m.status)
      }
    },
  })

  return result.data.text
}

async function toBase64(source: File | string): Promise<string> {
  if (typeof source === 'string') return source.split(',')[1] ?? source
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = e => resolve((e.target!.result as string).split(',')[1])
    reader.readAsDataURL(source)
  })
}

async function preprocessImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = e => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width  = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        const factor = (259 * 2.6) / (259 - 1.6)
        for (let i = 0; i < data.length; i += 4) {
          const grey = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]
          const val  = Math.min(255, Math.max(0, factor * (grey - 128) + 128))
          data[i] = data[i+1] = data[i+2] = val
        }
        ctx.putImageData(imageData, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = e.target!.result as string
    }
    reader.readAsDataURL(file)
  })
}