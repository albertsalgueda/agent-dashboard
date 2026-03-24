'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GatewayClient } from './gateway'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

export function useGateway(gatewayUrl: string | null, token: string | null) {
  const clientRef = useRef<GatewayClient | null>(null)
  const [state, setState] = useState<ConnectionState>('disconnected')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const streamBufferRef = useRef('')

  useEffect(() => {
    if (!gatewayUrl || !token) return

    const client = new GatewayClient(gatewayUrl, token)
    clientRef.current = client

    const unsubState = client.onState((s) => setState(s))

    client.connect()

    return () => {
      unsubState()
      client.disconnect()
      clientRef.current = null
    }
  }, [gatewayUrl, token])

  useEffect(() => {
    if (state !== 'connected' || !clientRef.current) return

    clientRef.current.chatHistory().then((result) => {
      const history = result as { entries?: Array<{ role: string; text?: string; id?: string }> }
      if (history?.entries) {
        const mapped: ChatMessage[] = history.entries
          .filter((e) => e.text && (e.role === 'user' || e.role === 'assistant'))
          .map((e, i) => ({
            id: e.id ?? `hist-${i}`,
            role: e.role as 'user' | 'assistant',
            content: e.text ?? '',
          }))
        setMessages(mapped)
      }
    }).catch(() => {
      // History fetch failed, start fresh
    })
  }, [state])

  const sendMessage = useCallback((text: string) => {
    if (!clientRef.current || state !== 'connected' || !text.trim()) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    }
    setMessages((prev) => [...prev, userMsg])

    const assistantId = `assistant-${Date.now()}`
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }])
    setIsStreaming(true)
    streamBufferRef.current = ''

    const { promise } = clientRef.current.chatSend(text.trim(), (event, payload) => {
      const p = payload as Record<string, unknown>

      if (event === 'agent.text' || event === 'agent.text.delta') {
        const delta = (p.delta as string) ?? (p.text as string) ?? ''
        streamBufferRef.current += delta
        const current = streamBufferRef.current
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: current } : m)),
        )
      }

      if (event === 'agent.message') {
        const text = (p.text as string) ?? ''
        if (text) {
          streamBufferRef.current = text
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)),
          )
        }
      }
    })

    promise
      .then((result) => {
        const r = result as Record<string, unknown>
        if (r?.text && typeof r.text === 'string' && r.text.length > streamBufferRef.current.length) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: r.text as string } : m)),
          )
        }
      })
      .catch(() => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || 'Failed to get response.' }
              : m,
          ),
        )
      })
      .finally(() => {
        setIsStreaming(false)
      })
  }, [state])

  return { state, messages, sendMessage, isStreaming }
}
