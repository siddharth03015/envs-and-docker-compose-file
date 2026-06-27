"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthModal } from "@/context/AuthModalContext";
import { useShortcutsModal } from "@/context/ShortcutsModalContext";
import { useMarketStore } from "@/store/market";
import { useTerminalStore } from "@/store/terminal";
import wsManager from "@/ws/manager";
import { fmtPrice, fmtPct } from "@/lib/formatters";

interface HeaderProps { variant?: "landing" | "default" }

const SunIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)
const MoonIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

const KeyboardIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="6" y1="9" x2="6" y2="9.01" />
    <line x1="10" y1="9" x2="10" y2="9.01" />
    <line x1="14" y1="9" x2="14" y2="9.01" />
    <line x1="18" y1="9" x2="18" y2="9.01" />
    <line x1="6" y1="13" x2="6" y2="13.01" />
    <line x1="18" y1="13" x2="18" y2="13.01" />
  </svg>
)

export default function Header({ variant = "default" }: HeaderProps) {
  const [wsConnected, setWsConnected] = useState(false);
  const [wsLatency,   setWsLatency]   = useState(0);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [mounted,     setMounted]     = useState(false);

  const { openModal, user, logout } = useAuthModal();
  const { openModal: openShortcutsModal } = useShortcutsModal();
  const router   = useRouter();
  const pathname = usePathname();

  const theme   = useTerminalStore(s => s.theme);
  const setTheme = useTerminalStore(s => s.setTheme);
  const symbol  = useTerminalStore(s => s.symbol);
  const tickers = useMarketStore(s => s.tickers);
  const symbols = useMarketStore(s => s.symbols);
  const ticker  = tickers[symbol];
  const symInfo = symbols.find(s => s.symbol === symbol);
  const change  = ticker?.change_24h_pct ?? symInfo?.change_24h_pct ?? 0;

  useEffect(() => {
    setMounted(true);
    const check = () => {
      setWsConnected(wsManager.isConnected)
      if (wsManager.latencyMs > 0) setWsLatency(wsManager.latencyMs)
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  };

  const navLinks = [
    { href: '/trade',         label: 'Terminal'  },
    { href: '/charts',        label: 'Charts'    },
    { href: '/public-market', label: 'Markets'   },
    { href: '/dashboard',     label: 'Dashboard' },
  ];

  return (
    <nav className={`top-nav${variant === "landing" ? " top-nav-landing" : ""}`}>

      {/* ── Brand ── */}
      <div className="nb-brand" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
        <span className="nb-logo-dot" />
        <span className="nb-logo-text">Synthetic<span className="nb-logo-accent">Bull</span></span>
      </div>

      {/* ── Nav links (desktop) ── */}
      {variant !== "landing" && (
        <div className="nb-links desktop-only">
          {navLinks.map(({ href, label }) => (
            <button
              key={href}
              className={`nb-link${pathname === href ? ' nb-link-active' : ''}`}
              onClick={() => router.push(href)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Center ticker strip (terminal mode, desktop) ── */}
      {variant !== "landing" && ticker && (
        <div className="nb-ticker desktop-only">
          <span className="nb-ticker-sym">{symbol}</span>
          <span className="nb-ticker-price">${fmtPrice(ticker.last_price, symInfo?.price_dp ?? 2)}</span>
          <span className={`nb-ticker-chg ${change >= 0 ? 'text-buy' : 'text-sell'}`}>
            {change >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(change))}
          </span>
        </div>
      )}

      {/* ── Right cluster ── */}
      <div className="nb-right">

        {/* WS status pill */}
        {variant !== "landing" && (
          <div className="nb-ws desktop-only" title={wsConnected ? `WebSocket connected${wsLatency > 0 ? ` · ${wsLatency}ms` : ''}` : 'Reconnecting…'}>
            <span className={`nb-ws-dot${wsConnected ? '' : ' nb-ws-dot-off'}`} />
            <span className="nb-ws-label">{wsConnected ? 'LIVE' : 'REC…'}</span>
            {wsConnected && wsLatency > 0 && (
              <span style={{ fontSize: 10, color: wsLatency < 200 ? 'var(--c-buy)' : wsLatency < 500 ? '#F59E0B' : 'var(--c-sell)', marginLeft: 4, fontFamily: 'var(--font-mono)' }}>
                {wsLatency}ms
              </span>
            )}
          </div>
        )}

        {/* Shortcuts button */}
        {variant !== "landing" && (
          <button suppressHydrationWarning className="nb-icon-btn" onClick={openShortcutsModal} title="Keyboard shortcuts (Shift + ?)">
            <KeyboardIcon />
          </button>
        )}

        {/* Theme toggle */}
        <button suppressHydrationWarning className="nb-icon-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {mounted ? (theme === "dark" ? <SunIcon /> : <MoonIcon />) : <SunIcon />}
        </button>

        {/* Auth */}
        {user ? (
          <div className="nb-user-cluster">
            <div className="nb-avatar">{user.username.charAt(0).toUpperCase()}</div>
            <span className="nb-username desktop-only">{user.username}</span>
            <button className="nb-btn-ghost" onClick={logout}>Logout</button>
          </div>
        ) : (
          <div className="nb-auth-cluster">
            <button className="nb-btn-ghost" onClick={() => openModal("login")}>Log in</button>
            <button className="nb-btn-primary" onClick={() => openModal("register")}>Sign up</button>
          </div>
        )}

        {/* Hamburger (mobile) */}
        {variant !== "landing" && (
          <button className="nb-hamburger hamburger-btn" onClick={() => setMenuOpen(v => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              {menuOpen
                ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                : <><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></>
              }
            </svg>
          </button>
        )}
      </div>

      {/* ── Mobile dropdown ── */}
      {menuOpen && variant !== "landing" && (
        <div className="nb-mobile-menu">
          {navLinks.map(({ href, label }) => (
            <button
              key={href}
              className={`nb-mobile-link${pathname === href ? ' nb-link-active' : ''}`}
              onClick={() => { router.push(href); setMenuOpen(false) }}
            >
              {label}
            </button>
          ))}
          {ticker && (
            <div className="nb-mobile-ticker">
              <span className="nb-ticker-sym">{symbol}</span>
              <span className="nb-ticker-price">${fmtPrice(ticker.last_price, symInfo?.price_dp ?? 2)}</span>
              <span className={`nb-ticker-chg ${change >= 0 ? 'text-buy' : 'text-sell'}`}>{fmtPct(change)}</span>
            </div>
          )}
          <div className="nb-ws" style={{ padding: '8px 0' }}>
            <span className={`nb-ws-dot${wsConnected ? '' : ' nb-ws-dot-off'}`} />
            <span className="nb-ws-label">{wsConnected ? 'Live' : 'Reconnecting…'}</span>
          </div>
        </div>
      )}
    </nav>
  );
}
