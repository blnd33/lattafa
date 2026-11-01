import { useEffect, useRef, useState } from 'react'
import { CameraOff } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/i18n'

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

export const cameraScanSupported = (): boolean =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

/**
 * Phone/tablet camera as a barcode scanner, using the browser's built-in
 * BarcodeDetector (Chrome/Edge on Android, recent desktop Chrome). Needs https or
 * localhost. On browsers without it, the sell screen hides the camera button —
 * USB/Bluetooth scanners and manual entry keep working everywhere.
 */
export function CameraScanner({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (code: string) => void }) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let stopped = false
    setError('')
    void (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector
        const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128', 'code_39', 'qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped || !video.current) { stream.getTracks().forEach((tr) => tr.stop()); return }
        video.current.srcObject = stream
        await video.current.play()
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return
          try {
            const found = await detector.detect(video.current)
            if (found[0]?.rawValue) { onScan(found[0].rawValue) }
          } catch { /* frame not ready */ }
        }, 250)
      } catch (e) {
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? t('scan.denied') : t('scan.unsupported'))
      }
    })()
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Modal open={open} onClose={onClose} title={t('scan.title')} size="sm">
      {error ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center text-fg-2"><CameraOff className="size-10" /><p className="text-sm">{error}</p></div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-gold shadow-[0_0_0_9999px_rgba(0,0,0,.45)]" />
        </div>
      )}
      <p className="mt-3 text-center text-xs text-fg-2">{t('scan.hint')}</p>
    </Modal>
  )
}
