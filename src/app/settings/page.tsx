'use client'

import { useEffect, useState } from 'react'
import { useConnectionParams } from '@/lib/use-params'
import { useGateway } from '@/lib/use-gateway'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  Check,
  Copy,
  Globe,
  Key,
  Loader2,
  Server,
  Wifi,
  WifiOff,
} from 'lucide-react'
import Link from 'next/link'
import { GatewayClient } from '@/lib/gateway'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

export default function SettingsPage() {
  const { gateway, token } = useConnectionParams()
  const { state } = useGateway(gateway, token)
  const [gatewayStatus, setGatewayStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (state !== 'connected' || !gateway || !token) return

    setLoading(true)
    const client = new GatewayClient(gateway, token)

    let resolved = false
    const unsub = client.onState((s) => {
      if (s === 'connected' && !resolved) {
        resolved = true
        client.status().then((result) => {
          setGatewayStatus(result as Record<string, unknown>)
        }).catch(() => {}).finally(() => {
          setLoading(false)
          client.disconnect()
        })
      }
    })

    client.connect()

    return () => {
      unsub()
      client.disconnect()
    }
  }, [state, gateway, token])

  const backHref = gateway && token
    ? `/?gateway=${encodeURIComponent(gateway)}&token=${encodeURIComponent(token)}`
    : '/'

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link
          href={backHref}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-sm font-medium">Settings</span>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {/* Connection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" />
              Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              {state === 'connected' ? (
                <Badge variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-400">
                  <Wifi className="h-3 w-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5 border-red-500/30 text-red-400">
                  <WifiOff className="h-3 w-3" /> {state}
                </Badge>
              )}
            </div>
            <Separator />
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">Gateway URL</label>
              <div className="flex items-center gap-2">
                <Input readOnly value={gateway ?? ''} className="font-mono text-xs" />
                {gateway && <CopyButton text={gateway} />}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">Auth Token</label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  type="password"
                  value={token ?? ''}
                  className="font-mono text-xs"
                />
                {token && <CopyButton text={token} />}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Gateway Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" />
              Gateway
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching status...
              </div>
            ) : gatewayStatus ? (
              <pre className="overflow-auto rounded-lg bg-muted p-3 text-xs">
                {JSON.stringify(gatewayStatus, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                {state === 'connected' ? 'Could not fetch gateway status.' : 'Connect to view gateway info.'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Token Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The gateway token is passed via URL parameters. It authenticates
              this dashboard as an operator client with read/write access.
            </p>
            <p>
              On managed instances, the token is set during provisioning and
              stored in the instance configuration.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
