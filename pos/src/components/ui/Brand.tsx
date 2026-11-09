import { useEffect, useId, useState } from 'react'
import QRCode from 'qrcode'
import type { BottleShape, Product } from '@/data/types'
import { code128Bars } from '@/lib/code128'
import { cn } from './cn'

const logoSrc = `${import.meta.env.BASE_URL}logo.png`

/** The Lattafa drop-and-calligraphy mark. */
export function Logo({ className, mono }: { className?: string; mono?: boolean }) {
  return <img src={logoSrc} alt="Lattafa" draggable={false} className={cn('h-10 w-auto select-none', mono && 'brightness-0', className)} />
}

export const CODA_URL = 'https://coda-agency.net/'

/**
 * Who built this, in the credit line at the foot of every app — tapping the name
 * opens the agency's site in a tab of its own, so a sale in progress is left alone.
 * The padding is only there to give a finger something to hit at this size.
 */
export function CodaLink({ className }: { className?: string }) {
  return (
    <a href={CODA_URL} target="_blank" rel="noopener noreferrer"
      className={cn('-my-1 inline-block py-1 font-semibold underline-offset-2 hover:underline focus-visible:underline', className)}>
      Coda Agency
    </a>
  )
}

/** Logo + wordmark, used in the top bar / login. */
export function BrandMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const h = size === 'lg' ? 'h-24' : size === 'sm' ? 'h-8' : 'h-10'
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Logo className={h} />
      <span className={cn('font-serif font-semibold tracking-wide', size === 'lg' ? 'text-4xl' : size === 'sm' ? 'text-lg' : 'text-2xl')}>Lattafa</span>
    </span>
  )
}

/** Generated perfume bottle — placeholder until real photos are uploaded. */
export function BottleArt({ c1, c2, shape, className }: { c1: string; c2: string; shape: BottleShape; className?: string }) {
  const id = useId().replace(/:/g, '')
  const g = `url(#gl${id})`
  const cp = `url(#cp${id})`
  const label = (x: number, y: number, w: number, h: number) => (
    <>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="#fff" opacity={0.9} />
      <rect x={x + 6} y={y + h / 2 - 4} width={w - 12} height={3} rx={1.5} fill="#D4A548" />
      <rect x={x + 10} y={y + h / 2 + 3} width={w - 20} height={2} rx={1} fill="#D4A548" opacity={0.6} />
    </>
  )
  let body
  switch (shape) {
    case 'tall':
      body = (<><rect x="48" y="4" width="24" height="32" rx="4" fill={cp} /><rect x="54" y="34" width="12" height="10" fill="#B58A2E" /><rect x="36" y="44" width="48" height="116" rx="9" fill={g} /><rect x="41" y="52" width="6" height="98" rx="3" fill="#fff" opacity=".22" />{label(44, 92, 32, 36)}</>)
      break
    case 'round':
      body = (<><rect x="46" y="6" width="28" height="24" rx="5" fill={cp} /><rect x="52" y="28" width="16" height="12" fill="#B58A2E" /><circle cx="60" cy="112" r="46" fill={g} /><path d="M26 98a36 36 0 0 1 20-28" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" opacity=".26" />{label(42, 100, 36, 28)}</>)
      break
    case 'flask':
      body = (<><rect x="48" y="6" width="24" height="22" rx="4" fill={cp} /><rect x="54" y="26" width="12" height="14" fill="#B58A2E" /><path d="M40 40h40l20 108q1 12-11 12H31q-12 0-11-12Z" fill={g} /><path d="M42 50l-12 96" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".22" />{label(42, 104, 36, 30)}</>)
      break
    default:
      body = (<><rect x="44" y="6" width="32" height="28" rx="5" fill={cp} /><rect x="50" y="32" width="20" height="10" fill="#B58A2E" /><rect x="24" y="42" width="72" height="118" rx="14" fill={g} /><rect x="30" y="52" width="7" height="98" rx="3.5" fill="#fff" opacity=".24" />{label(38, 92, 44, 36)}</>)
  }
  return (
    <svg viewBox="0 0 120 170" aria-hidden className={cn('h-full w-auto', className)}>
      <defs>
        <linearGradient id={`gl${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></linearGradient>
        <linearGradient id={`cp${id}`} x1="0" x2="1"><stop offset="0" stopColor="#F0D58F" /><stop offset=".5" stopColor="#D4A548" /><stop offset="1" stopColor="#9C7420" /></linearGradient>
      </defs>
      <ellipse cx="60" cy="163" rx="34" ry="4.5" fill="#000" opacity=".13" />
      {body}
    </svg>
  )
}

/** Product picture: the uploaded photo if there is one, otherwise the generated bottle. */
export function ProductImage({ product, className, imgClassName }: { product: Pick<Product, 'image' | 'art'>; className?: string; imgClassName?: string }) {
  return (
    <div className={cn('grid place-items-center overflow-hidden bg-[image:var(--img-bg)]', className)}>
      {product.image ? (
        <img src={product.image} alt="" loading="lazy" draggable={false} className={cn('h-full w-full object-contain', imgClassName)} />
      ) : (
        <BottleArt {...product.art} className={cn('h-[86%]', imgClassName)} />
      )}
    </div>
  )
}

/** Code 128 barcode as inline SVG (works on screen and when printing). */
export function Barcode({ value, height = 44, showText = true, className }: { value: string; height?: number; showText?: boolean; className?: string }) {
  let geo
  try { geo = code128Bars(value) } catch { return <span className="text-xs text-danger">{value}</span> }
  return (
    <div className={cn('inline-flex flex-col items-center', className)}>
      <svg viewBox={`0 0 ${geo.width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} fill="#000" shapeRendering="crispEdges" role="img" aria-label={value}>
        {geo.bars.map(([x, w], i) => <rect key={i} x={x} y={0} width={w} height={height} />)}
      </svg>
      {showText && <span className="mt-0.5 font-mono text-[10px] tracking-wider">{value}</span>}
    </div>
  )
}

/** QR code rendered locally (no network) as SVG. */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((s) => { if (alive) setSvg(s) })
      .catch(() => { if (alive) setSvg('') })
    return () => { alive = false }
  }, [value])
  if (!svg) return null
  return <div aria-hidden className={cn('[&>svg]:h-full [&>svg]:w-full', className)} dangerouslySetInnerHTML={{ __html: svg }} />
}
