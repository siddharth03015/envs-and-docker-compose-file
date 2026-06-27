'use client'
import { useEffect } from 'react'
import wsManager from '@/ws/manager'
import { WS_EVT } from '@/constants'
import { useMarketStore } from '@/store/market'
import { useTerminalStore } from '@/store/terminal'
import { fetchOpenOrders, fetchPortfolio, fetchMyTrades, normalizeCandle } from '@/lib/market'
import type { Ticker, OrderBook, Trade, Portfolio, WsOhlcvPayload } from '@/types'

export function useWS(token: string | null, symbol: string) {
  const { setTicker, upsertCandle, setOrderBook, pushTrade } = useMarketStore.getState()
  const { setPortfolio, setOpenOrders, setMyTrades, pushToast } = useTerminalStore.getState()

  useEffect(() => {
    wsManager.connect(token, symbol)
    return () => { /* keep alive — disconnect only on logout */ }
  }, [token]) // eslint-disable-line

  useEffect(() => {
    wsManager.changeSymbol(symbol)
  }, [symbol])

  useEffect(() => {
    const onTicker = (p: unknown) => setTicker(p as Ticker)

    const onOhlcv = (p: unknown) => {
      const pl = p as WsOhlcvPayload
      upsertCandle(`${pl.symbol}:${pl.interval}`, normalizeCandle(pl.candle), pl.is_closed)
    }

    const onBook = (p: unknown) => {
      const ob = p as OrderBook
      setOrderBook(ob.symbol, ob)
    }

    const onTrade = (p: unknown) => {
      const t = p as Trade
      pushTrade(t.symbol, t)
    }

    // WS portfolio: {type, username, data: Portfolio}
    const onPort = (p: unknown) => {
      const msg = p as { data: Portfolio }
      if (msg.data) setPortfolio(msg.data)
    }

    const onOrderAck = (p: unknown) => {
      const msg = p as { payload?: { status?: string } }
      pushToast(`Order accepted — ${msg.payload?.status ?? 'OPEN'}`, true)
      fetchOpenOrders().then(setOpenOrders).catch(() => { })
    }

    const onOrderFill = (p: unknown) => {
      const msg = p as { payload?: { price?: number; quantity?: number } }
      const price = msg.payload?.price?.toFixed(2) ?? ''
      const qty = msg.payload?.quantity?.toFixed(4) ?? ''
      pushToast(`Filled ${qty} @ $${price}`, true)
      fetchOpenOrders().then(setOpenOrders).catch(() => { })
      fetchPortfolio().then(setPortfolio).catch(() => { })
      fetchMyTrades().then(setMyTrades).catch(() => { })
    }

    const onOrderCancel = (p: unknown) => {
      const msg = p as { payload?: { id?: string } }
      pushToast(`Order cancelled`, false)
      fetchOpenOrders().then(setOpenOrders).catch(() => { })
      void msg
    }

    const onError = (p: unknown) => {
      const msg = p as { message?: string; code?: string }
      pushToast(msg.message ?? msg.code ?? 'Error', false)
    }

    wsManager.on(WS_EVT.TICKER, onTicker)
    wsManager.on(WS_EVT.OHLCV, onOhlcv)
    wsManager.on(WS_EVT.ORDERBOOK, onBook)
    wsManager.on(WS_EVT.TRADE, onTrade)
    wsManager.on(WS_EVT.PORTFOLIO, onPort)
    wsManager.on(WS_EVT.ORDER_ACK, onOrderAck)
    wsManager.on(WS_EVT.ORDER_FILL, onOrderFill)
    wsManager.on(WS_EVT.ORDER_CANCEL, onOrderCancel)
    wsManager.on(WS_EVT.ERROR, onError)

    return () => {
      wsManager.off(WS_EVT.TICKER, onTicker)
      wsManager.off(WS_EVT.OHLCV, onOhlcv)
      wsManager.off(WS_EVT.ORDERBOOK, onBook)
      wsManager.off(WS_EVT.TRADE, onTrade)
      wsManager.off(WS_EVT.PORTFOLIO, onPort)
      wsManager.off(WS_EVT.ORDER_ACK, onOrderAck)
      wsManager.off(WS_EVT.ORDER_FILL, onOrderFill)
      wsManager.off(WS_EVT.ORDER_CANCEL, onOrderCancel)
      wsManager.off(WS_EVT.ERROR, onError)
    }
  }, []) // eslint-disable-line
}
