'use client'

interface BookingModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

export default function BookingModal({ title, onClose, children }: BookingModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#0f172a]">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none transition-colors">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}