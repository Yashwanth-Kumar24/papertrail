/**
 * OCR wrapper using Tesseract.js — runs 100% in the browser.
 * The image never leaves the device.
 *
 * Optional: canvas pre-processing (grayscale + contrast boost)
 * improves Tesseract accuracy on thermal receipts significantly.
 */

// Tesseract is loaded dynamically so the bundle stays small
// and Next.js doesn't try to SSR it.

export type OcrProgressCallback = (pct: number, status: string) => void

/** Run OCR on a File or data-URL string. Returns raw text. */
export async function recognizeReceipt(
  source: File | string,
  onProgress?: OcrProgressCallback
): Promise<string> {
  // Dynamic import — Tesseract is browser-only
  const Tesseract = (await import('tesseract.js')).default

  const preprocessed =
    source instanceof File
      ? await preprocessImage(source)
      : source

  const result = await Tesseract.recognize(preprocessed, 'eng', {
    logger: (m: { status: string; progress: number }) => {
      if (onProgress && m.status === 'recognizing text') {
        onProgress(Math.round(m.progress * 100), m.status)
      }
    },
  })

  return result.data.text
}

/**
 * Canvas-based pre-processing:
 *  1. Convert to grayscale
 *  2. Boost contrast (helps with faded thermal receipts)
 *  3. Return as a data-URL that Tesseract can consume
 */
async function preprocessImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const canvas  = document.createElement('canvas')
        canvas.width  = img.width
        canvas.height = img.height
        const ctx     = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)

        // Greyscale + contrast
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data      = imageData.data
        const contrast  = 1.6  // 1.0 = no change, > 1 = more contrast
        const factor    = (259 * (contrast + 1)) / (1 * (259 - contrast))

        for (let i = 0; i < data.length; i += 4) {
          // Luma greyscale
          const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          // Apply contrast
          const val  = Math.min(255, Math.max(0, factor * (grey - 128) + 128))
          data[i] = data[i + 1] = data[i + 2] = val
        }

        ctx.putImageData(imageData, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = e.target!.result as string
    }
    reader.readAsDataURL(file)
  })
}
