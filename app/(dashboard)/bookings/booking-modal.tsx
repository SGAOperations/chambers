'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

interface BookingModalProps {
  title: string
  /**
   * Shown beside the title. For provenance an admin needs before they start
   * editing -- the NUSSO pill (issue #188) -- rather than anything the form
   * itself can say, since the forms below are shared by created-here and
   * came-from-NUSSO bookings alike.
   */
  badge?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}

export default function BookingModal({ title, badge, onClose, children }: BookingModalProps) {
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
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-[#f0f6ff]">{title}</h2>
            {badge}
          </div>
          <button onClick={onClose} className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}