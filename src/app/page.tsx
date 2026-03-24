'use client'

import { useRef, useEffect, useState, type FormEvent } from 'react'
import { useConnectionParams } from '@/lib/use-params'
import { useGateway, type ChatMessage } from '@/lib/use-gateway'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Bot,
  Circle,
  Loader2,
  Send,
  Settings,
  User,
  Wifi,
  WifiOff,
} from 'lucide-react'
import Link from 'next/link'

function ConnectionBadge({ state }: { state: string }) {
  if (state === 'connected')
    return (
      <Badge variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-400">
        <Wifi className="h-3 w-3" /> Connected
      </Badge>
    )
  if (state === 'connecting')
    return (
      <Badge variant="outline" className="gap-1.5 border-yellow-500/30 text-yellow-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Connecting
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1.5 border-red-500/30 text-red-400">
      <WifiOff className="h-3 w-3" /> Disconnected
    </Badge>
  )
}

function MessageBubble({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {message.content ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Circle className="h-2 w-2 animate-pulse fill-current" />
            <Circle className="h-2 w-2 animate-pulse fill-current [animation-delay:150ms]" />
            <Circle className="h-2 w-2 animate-pulse fill-current [animation-delay:300ms]" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled: boolean
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim() || disabled) return
    onSend(value)
    setValue('')
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-border bg-background p-4">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message..."
        disabled={disabled}
        rows={1}
        className="min-h-[44px] max-h-[160px] resize-none rounded-xl border-border bg-muted/50"
      />
      <Button
        type="submit"
        size="icon"
        disabled={disabled || !value.trim()}
        className="h-[44px] w-[44px] shrink-0 rounded-xl"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  )
}

export default function ChatPage() {
  const { gateway, token } = useConnectionParams()
  const { state, messages, sendMessage, isStreaming } = useGateway(gateway, token)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (!gateway || !token) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-4">
          <Bot className="mx-auto h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Agent Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Missing connection parameters. This dashboard should be opened with
            gateway and token URL parameters.
          </p>
          <code className="block rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
            ?gateway=ws://host:18789&token=your_token
          </code>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">Agent</span>
          <ConnectionBadge state={state} />
        </div>
        <Link
          href={`/settings?gateway=${encodeURIComponent(gateway)}&token=${encodeURIComponent(token)}`}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-4 p-4">
          {messages.length === 0 && state === 'connected' && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bot className="mb-4 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Send a message to start a conversation with the agent.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <ChatInput onSend={sendMessage} disabled={state !== 'connected' || isStreaming} />
    </div>
  )
}
