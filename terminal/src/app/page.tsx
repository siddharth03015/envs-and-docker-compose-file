"use client";

import React, { useEffect, useRef } from "react";
import { useAuthModal } from "@/context/AuthModalContext";
import { useMarketStore } from "@/store/market";
import Header from "@/components/Header";
import Link from "next/link";
import { fmtPrice, fmtPct } from "@/lib/formatters";
import "./landing.css";

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { openModal, user } = useAuthModal();
  const symbols = useMarketStore(s => s.symbols);
  const tickers = useMarketStore(s => s.tickers);

  const hudLeft  = symbols.slice(0, 3);
  const hudRight = symbols.slice(3, 6);

  const tickerItems = symbols.length > 0
    ? symbols.map(s => {
        const t = tickers[s.symbol];
        const chg = t?.change_24h_pct ?? s.change_24h_pct ?? 0;
        return {
          sym:   s.symbol,
          price: t ? fmtPrice(t.last_price, s.price_dp) : '—',
          chg:   fmtPct(chg),
          up:    chg >= 0,
        };
      })
    : [
        { sym: 'BTC-USD', price: '—', chg: '—', up: true },
        { sym: 'ETH-USD', price: '—', chg: '—', up: true },
        { sym: 'SOL-USD', price: '—', chg: '—', up: true },
      ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W: number, H: number, rafId: number;
    let candles: { o: number; c: number; h: number; l: number }[] = [];
    let particles: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] = [];
    let frame = 0;

    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    const rand   = (a: number, b: number) => a + Math.random() * (b - a);

    const genCandles = (n: number) => {
      let price = 22800;
      return Array.from({ length: n }, () => {
        const o = price, c = o + rand(-55, 65);
        const h = Math.max(o, c) + rand(6, 32), l = Math.min(o, c) - rand(6, 32);
        price = c;
        return { o, c, h, l };
      });
    };

    const initParticles = () => {
      particles = Array.from({ length: 50 }, () => {
        const side = Math.random() < 0.5 ? 'left' : 'right';
        return { x: side === 'left' ? rand(0, W * 0.25) : rand(W * 0.75, W), y: rand(0, H), vx: rand(-0.1, 0.1), vy: rand(-0.07, 0.04), r: rand(0.4, 1.4), a: rand(0.06, 0.22) };
      });
    };

    const drawGrid = () => {
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    };

    const drawCandles = () => {
      const cw = 11, gap = 3, total = cw + gap;
      const edgeW = Math.floor(W * 0.22);
      const nSide = Math.max(6, Math.floor(edgeW / total));
      if (!candles.length || frame % 150 === 0) candles = genCandles(nSide * 2 + 10);

      const allPrices = candles.flatMap(c => [c.h, c.l]);
      const mn = Math.min(...allPrices), mx = Math.max(...allPrices), rng = mx - mn || 1;
      const chartTop = H * 0.10, chartBot = H * 0.90;
      const toY = (v: number) => chartTop + (1 - (v - mn) / rng) * (chartBot - chartTop);

      candles.slice(0, nSide).forEach((c, i) => {
        const x = 8 + i * total;
        const alpha = Math.max(0, 1 - (x / edgeW) * 1.1);
        if (alpha <= 0.02) return;
        const oy = toY(c.o), cy = toY(c.c), hy = toY(c.h), ly = toY(c.l);
        const up = c.c >= c.o;
        ctx.globalAlpha = alpha * 0.75;
        ctx.strokeStyle = up ? '#00e682' : '#ff4560'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + cw / 2, hy); ctx.lineTo(x + cw / 2, Math.min(oy, cy));
        ctx.moveTo(x + cw / 2, Math.max(oy, cy)); ctx.lineTo(x + cw / 2, ly); ctx.stroke();
        ctx.fillStyle = up ? 'rgba(0,230,130,0.78)' : 'rgba(255,69,96,0.78)';
        ctx.fillRect(x, Math.min(oy, cy), cw, Math.max(Math.abs(cy - oy), 1.5));
      });

      const rightCds = candles.slice(nSide, nSide * 2);
      rightCds.forEach((c, i) => {
        const x = W - 8 - (i + 1) * total;
        const alpha = Math.max(0, 1 - ((W - (x + cw)) / edgeW) * 1.1);
        if (alpha <= 0.02) return;
        const oy = toY(c.o), cy = toY(c.c), hy = toY(c.h), ly = toY(c.l);
        const up = c.c >= c.o;
        ctx.globalAlpha = alpha * 0.75;
        ctx.strokeStyle = up ? '#00e682' : '#ff4560'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + cw / 2, hy); ctx.lineTo(x + cw / 2, Math.min(oy, cy));
        ctx.moveTo(x + cw / 2, Math.max(oy, cy)); ctx.lineTo(x + cw / 2, ly); ctx.stroke();
        ctx.fillStyle = up ? 'rgba(0,230,130,0.78)' : 'rgba(255,69,96,0.78)';
        ctx.fillRect(x, Math.min(oy, cy), cw, Math.max(Math.abs(cy - oy), 1.5));
      });
      ctx.globalAlpha = 1;
      const last = rightCds[0] || candles[0];
      return { lastX: W - 8 - cw / 2, lastY: toY(last.c) };
    };

    const render = () => {
      frame++;
      const isL = document.documentElement.getAttribute('data-theme') === 'light';
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = isL ? '#f8f9fb' : '#07080d'; ctx.fillRect(0, 0, W, H);
      if (!isL) {
        const grd = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.55);
        grd.addColorStop(0, 'rgba(109,40,217,0.04)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
      }
      ctx.strokeStyle = isL ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'; drawGrid();
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = isL ? `rgba(15,23,42,${p.a * 0.5})` : `rgba(126,34,206,${p.a})`; ctx.fill();
      });
      const { lastX, lastY } = drawCandles();
      const r1 = 3 + Math.sin(Date.now() / 500);
      const r2 = 8 + Math.sin(Date.now() / 500) * 2;
      ctx.beginPath(); ctx.arc(lastX, lastY, r2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,230,130,0.12)'; ctx.fill();
      ctx.beginPath(); ctx.arc(lastX, lastY, r1, 0, Math.PI * 2); ctx.fillStyle = '#00e682'; ctx.fill();
      rafId = requestAnimationFrame(render);
    };

    resize(); initParticles(); render();
    const onResize = () => { resize(); cancelAnimationFrame(rafId); candles = []; initParticles(); render(); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(rafId); };
  }, []);

  return (
    <div className="landing-body">
      <canvas ref={canvasRef} id="canvas-bg"></canvas>
      <div className="vignette"></div>

      <div className="ticker">
        <div className="ticker-track">
          {[...tickerItems, ...tickerItems].map((t, i) => (
            <span key={i} className="ticker-item-l">
              <span className="t-sym-l">{t.sym}</span>
              <span className="t-price-l">{t.price}</span>
              <span className={t.up ? "t-up-l" : "t-dn-l"}>{t.chg}</span>
            </span>
          ))}
        </div>
      </div>

      <Header variant="landing" />

      <div className="hud-left-l">
        {hudLeft.map((s, i) => {
          const t   = tickers[s.symbol];
          const chg = t?.change_24h_pct ?? s.change_24h_pct ?? 0;
          return (
            <div key={s.symbol} className="hud-card-l" style={{ animationDelay: `${0.3 + i * 0.15}s` }}>
              <div className="hud-sym-l">{s.symbol}</div>
              <div className="hud-price-l">{t ? `$${fmtPrice(t.last_price, s.price_dp)}` : '—'}</div>
              <div className={`hud-chg-l ${chg >= 0 ? 'up-l' : 'dn-l'}`}>{fmtPct(chg)}</div>
            </div>
          );
        })}
      </div>

      <div className="hud-right-l">
        {hudRight.map((s, i) => {
          const t   = tickers[s.symbol];
          const chg = t?.change_24h_pct ?? s.change_24h_pct ?? 0;
          return (
            <div key={s.symbol} className="hud-card-l" style={{ animationDelay: `${0.35 + i * 0.15}s` }}>
              <div className="hud-sym-l">{s.symbol}</div>
              <div className="hud-price-l">{t ? `$${fmtPrice(t.last_price, s.price_dp)}` : '—'}</div>
              <div className={`hud-chg-l ${chg >= 0 ? 'up-l' : 'dn-l'}`}>{fmtPct(chg)}</div>
            </div>
          );
        })}
      </div>

      <main className="main-l">
        <div className="hero-l">
          <h1 className="h1-l">The Market Edge<br />You <span className="accent-l">Actually</span> Needed</h1>
          <p className="hero-sub-l">
            Real-time simulated crypto &amp; stock exchange. Live order books, candlestick charts, GBM price simulation, and full portfolio tracking — all in one terminal.
          </p>
          <div className="hero-actions-l">
            {user ? (
              <Link href="/trade" className="cta-main-l" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                Open Terminal
              </Link>
            ) : (
              <button className="cta-main-l" onClick={() => openModal("register")}>Start Trading Free</button>
            )}
            <Link href="/public-market" className="cta-sec-l" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              View Markets
            </Link>
          </div>

          <div className="stats-row-l">
            <div className="stat-l">
              <div className="stat-val-l">8<span>+</span></div>
              <div className="stat-label-l">Live Markets</div>
            </div>
            <div className="stat-l">
              <div className="stat-val-l">60<span>+</span></div>
              <div className="stat-label-l">Trades / Second</div>
            </div>
            <div className="stat-l">
              <div className="stat-val-l"><span>&lt;</span>1ms</div>
              <div className="stat-label-l">Match Latency</div>
            </div>
            <div className="stat-l">
              <div className="stat-val-l">100<span>k</span></div>
              <div className="stat-label-l">Starting Capital</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
