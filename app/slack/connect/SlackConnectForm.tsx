'use client'

import { useEffect, useState } from 'react'

type Status = 'validating' | 'idle' | 'loading' | 'success' | 'error'

export default function SlackConnectForm({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('validating')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    fetch(`/api/slack/connect?token=${encodeURIComponent(token)}`)
      .then(res => {
        if (!res.ok) setStatus('error'), setErrorMessage('This link has expired or is invalid.')
        else setStatus('idle')
      })
      .catch(() => {
        setStatus('error')
        setErrorMessage('Something went wrong. Please try again.')
      })
  }, [token])

  async function handleConfirm() {
    setStatus('loading')
    try {
      const res = await fetch('/api/slack/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const data = await res.json()
        setErrorMessage(data.error ?? 'Something went wrong. Please try again.')
        setStatus('error')
      } else {
        setStatus('success')
      }
    } catch {
      setErrorMessage('Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-center justify-center px-4 relative">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-10 space-y-6 relative z-10">
        <div className="text-center space-y-1">
          <p className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</p>
          <p className="text-[#f0f6ff] font-semibold text-lg">Connect Slack</p>
        </div>

        {status === 'validating' && (
          <p className="text-[#93b8d8] text-sm text-center">Verifying link...</p>
        )}

        {status === 'idle' && (
          <>
            <p className="text-[#93b8d8] text-sm text-center">
              Click below to link your Slack account to your Chambers account.
            </p>
            <button
              onClick={handleConfirm}
              className="w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all"
            >
              Connect my Slack account
            </button>
          </>
        )}

        {status === 'loading' && (
          <p className="text-[#93b8d8] text-sm text-center">Linking your account...</p>
        )}

        {status === 'success' && (
          <p className="text-[#f0f6ff] text-sm text-center font-medium">
            Your Slack account is now linked. You can close this tab.
          </p>
        )}

        {status === 'error' && (
          <p className="text-[#c8102e] text-sm text-center">{errorMessage}</p>
        )}
      </div>
    </div>
  )
}
