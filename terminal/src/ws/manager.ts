import { WS_BASE } from '@/constants'

type Handler = (payload: unknown) => void

class WSManager {
  private ws:          WebSocket | null = null
  private token:       string | null = null
  private symbol:      string = 'BTC-USD'
  private handlers:    Map<string, Handler[]> = new Map()
  private dead:        boolean = true
  private retryMs:     number = 1500
  private _openAt:     number = 0
  private _latencyMs:  number = 0

  get latencyMs() { return this._latencyMs }

  connect(token: string | null, symbol: string) {
    if (!token) { this.disconnect(); return }
    this.dead   = false
    this.token  = token
    this.symbol = symbol
    // Close existing socket cleanly before opening a new one
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
    this._open()
  }

  disconnect() {
    this.dead  = true
    this.token = null
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }

  changeSymbol(symbol: string) {
    this.symbol = symbol
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'change_symbol', symbol }))
    }
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
  }

  off(event: string, handler: Handler) {
    const arr = this.handlers.get(event)
    if (!arr) return
    const i = arr.indexOf(handler)
    if (i !== -1) arr.splice(i, 1)
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private _open() {
    if (this.dead || !this.token) return
    const params = new URLSearchParams({ symbol: this.symbol, token: this.token })
    const ws = new WebSocket(`${WS_BASE}/ws?${params}`)
    this.ws = ws

    ws.onopen = () => {
      this._openAt = Date.now()
    }

    ws.onmessage = (e) => {
      try {
        if (this._openAt > 0) {
          this._latencyMs = Date.now() - this._openAt
          this._openAt = 0
        }
        const msg = JSON.parse(e.data) as { type: string }
        const handlers = this.handlers.get(msg.type)
        if (handlers) handlers.forEach(h => h(msg))
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      if (this.dead || !this.token) return
      setTimeout(() => this._open(), this.retryMs)
    }

    ws.onerror = () => {
      ws.onclose = null
      ws.close()
      if (this.dead || !this.token) return
      setTimeout(() => this._open(), this.retryMs)
    }
  }
}

const wsManager = new WSManager()
export default wsManager
