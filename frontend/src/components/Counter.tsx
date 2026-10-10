import { useEffect, useRef, useState } from 'react'

const ease = (t: number) => 1 - Math.pow(1 - t, 4)

/** Animated count-up/down number. Re-animates from the previous value on change. */
export default function Counter({ value, format, duration = 900 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(0)
  const current = useRef(0)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      current.current = value
      const id = requestAnimationFrame(() => setShown(value))
      return () => cancelAnimationFrame(id)
    }
    from.current = current.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const v = from.current + (value - from.current) * ease(t)
      current.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return <>{format(shown)}</>
}
