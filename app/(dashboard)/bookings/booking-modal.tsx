'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

interface BookingModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

export default function BookingModal({ title, onClose, children }: BookingModalProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#f0f6ff]">{title}</h2>
          <button onClick={onClose} className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}