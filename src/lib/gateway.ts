type GatewayMessage =
  | { type: 'req'; id: string; method: string; params: Record<string, unknown> }
  | { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: unknown }
  | { type: 'event'; event: string; payload?: unknown; seq?: number; stateVersion?: number }

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

type MessageHandler = (msg: GatewayMessage) => void
type StateHandler = (state: ConnectionState) => void

let counter = 0
function nextId(): string {
  return `dash-${++counter}-${Math.random().toString(36).slice(2, 8)}`
}

function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function generateDeviceIdentity() {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const pubRaw = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const publicKeyB64 = bufToBase64(pubRaw)
  const idHash = await crypto.subtle.digest('SHA-256', pubRaw)
  const deviceId = bufToHex(idHash)
  return { keyPair, publicKeyB64, deviceId }
}

async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(payload))
  return bufToBase64(sig)
}

export class GatewayClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private _state: ConnectionState = 'disconnected'
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private eventHandlers = new Set<MessageHandler>()
  private stateHandlers = new Set<StateHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private challengeNonce: string | null = null
  private deviceIdentity: { keyPair: CryptoKeyPair; publicKeyB64: string; deviceId: string } | null = null

  constructor(url: string, token: string) {
    this.url = url
    this.token = token
  }

  get state(): ConnectionState {
    return this._state
  }

  private setState(s: ConnectionState) {
    this._state = s
    this.stateHandlers.forEach((h) => h(s))
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  onEvent(handler: MessageHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  async connect() {
    if (this.ws) return
    this.setState('connecting')

    if (!this.deviceIdentity) {
      try {
        this.deviceIdentity = await generateDeviceIdentity()
      } catch {
        this.setState('error')
        return
      }
    }

    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onmessage = (ev) => {
      let msg: GatewayMessage
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      this.handleMessage(msg)
    }

    ws.onclose = () => {
      this.ws = null
      this.rejectAllPending('Connection closed')
      if (this._state !== 'disconnected') {
        this.setState('disconnected')
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      this.setState('error')
    }
  }

  disconnect() {
    this.setState('disconnected')
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.rejectAllPending('Disconnected')
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 3000)
  }

  private handleMessage(msg: GatewayMessage) {
    if (msg.type === 'event') {
      if (msg.event === 'connect.challenge') {
        const payload = msg.payload as { nonce: string; ts: number }
        this.challengeNonce = payload.nonce
        this.sendConnect()
        return
      }
      this.eventHandlers.forEach((h) => h(msg))
      return
    }

    if (msg.type === 'res') {
      if ((msg.payload as Record<string, unknown>)?.type === 'hello-ok') {
        this.setState('connected')
        return
      }

      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        this.pendingRequests.delete(msg.id)
        if (msg.ok) {
          pending.resolve(msg.payload)
        } else {
          pending.reject(new Error(JSON.stringify(msg.error)))
        }
      }
      return
    }
  }

  private async sendConnect() {
    if (!this.deviceIdentity) return

    const { keyPair, publicKeyB64, deviceId } = this.deviceIdentity
    const nonce = this.challengeNonce ?? ''
    const signedAt = Date.now()
    const scopes = 'operator.read,operator.write'

    const payloadStr = [deviceId, 'openclaw-control-ui', 'operator', scopes, this.token, nonce, String(signedAt)].join(':')
    let signature = ''
    try {
      signature = await signPayload(keyPair.privateKey, payloadStr)
    } catch {
      // Signing failed, send without - will work if dangerouslyDisableDeviceAuth is true
    }

    this.send({
      type: 'req',
      id: nextId(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'openclaw-control-ui',
          version: '1.0.0',
          platform: 'web',
          mode: 'webchat',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: this.token },
        locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        userAgent: 'agent-dashboard/1.0.0',
        device: {
          id: deviceId,
          publicKey: publicKeyB64,
          signature,
          signedAt,
          nonce,
        },
      },
    })
  }

  private send(msg: GatewayMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = nextId()
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.send({ type: 'req', id, method, params })
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request ${method} timed out`))
        }
      }, 30000)
    })
  }

  requestWithEvents(
    method: string,
    params: Record<string, unknown>,
    onEvent: (event: string, payload: unknown) => void,
  ): { promise: Promise<unknown>; id: string } {
    const id = nextId()
    const unsub = this.onEvent((msg) => {
      if (msg.type === 'event') {
        onEvent(msg.event, msg.payload)
      }
    })

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (v) => { unsub(); resolve(v) },
        reject: (e) => { unsub(); reject(e) },
      })
      this.send({ type: 'req', id, method, params })
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          unsub()
          reject(new Error(`Request ${method} timed out`))
        }
      }, 120000)
    })

    return { promise, id }
  }

  async chatHistory(): Promise<unknown> {
    return this.request('chat.history', {})
  }

  chatSend(
    text: string,
    onEvent: (event: string, payload: unknown) => void,
  ): { promise: Promise<unknown>; id: string } {
    return this.requestWithEvents('chat.send', { text }, onEvent)
  }

  async health(): Promise<unknown> {
    return this.request('health', {})
  }

  async status(): Promise<unknown> {
    return this.request('status', {})
  }

  private rejectAllPending(reason: string) {
    for (const [id, p] of this.pendingRequests) {
      p.reject(new Error(reason))
      this.pendingRequests.delete(id)
    }
  }
}
