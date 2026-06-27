package portfolio

import (
	"fmt"
	"sync"

	"github.com/opensoft/exchange-engine/internal/db"
	"github.com/opensoft/exchange-engine/internal/types"
)

const StartingCash = 100_000.0

// Manager holds all user portfolios in memory and syncs to SQLite
type Manager struct {
	mu         sync.RWMutex
	portfolios map[string]*Portfolio // userID -> Portfolio
	prices     map[string]float64   // symbol -> last price (for P&L)
}

func NewManager() *Manager {
	return &Manager{
		portfolios: make(map[string]*Portfolio),
		prices:     make(map[string]float64),
	}
}

// Load restores a user's portfolio from SQLite (called on login/register)
func (m *Manager) Load(userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.portfolios[userID]; exists {
		return nil // already in memory
	}

	rec, err := db.GetPortfolio(userID)
	if err != nil {
		return err
	}

	var p *Portfolio
	if rec == nil {
		p = New(userID, StartingCash)
	} else {
		p = New(userID, rec.Cash)
		p.RealizedPnL = rec.RealizedPnL
		for sym, pr := range rec.Positions {
			p.Positions[sym] = &Position{
				Symbol:        sym,
				Quantity:      pr.Quantity,
				AvgEntryPrice: pr.AvgEntryPrice,
			}
		}
	}
	m.portfolios[userID] = p
	return nil
}

// Get returns a portfolio, loading from DB if needed
func (m *Manager) Get(userID string) (*Portfolio, error) {
	m.mu.RLock()
	p, ok := m.portfolios[userID]
	m.mu.RUnlock()
	if ok {
		return p, nil
	}
	if err := m.Load(userID); err != nil {
		return nil, err
	}
	m.mu.RLock()
	p = m.portfolios[userID]
	m.mu.RUnlock()
	return p, nil
}

// ValidateOrder checks if user has enough resources for the order
func (m *Manager) ValidateOrder(userID, symbol string, side types.Side, qty, price float64, orderType types.OrderType) error {
	p, err := m.Get(userID)
	if err != nil {
		return fmt.Errorf("portfolio not found")
	}

	if orderType == types.Market {
		// For market orders we can't precisely check — allow and handle at fill
		return nil
	}

	if side == types.Buy {
		required := qty * price
		if p.GetCash() < required {
			return fmt.Errorf("insufficient funds: need %.2f, have %.2f", required, p.GetCash())
		}
	}
	// Short selling is allowed — no restriction on sell side
	return nil
}

// ApplyTrade updates both buyer and seller portfolios for an executed trade
func (m *Manager) ApplyTrade(trade *types.Trade) {
	buyer, _ := m.Get(trade.BuyerID)
	seller, _ := m.Get(trade.SellerID)

	if buyer != nil {
		buyer.ApplyBuy(trade.Symbol, trade.Price, trade.Quantity)
		m.persist(buyer)
	}
	if seller != nil {
		seller.ApplySell(trade.Symbol, trade.Price, trade.Quantity)
		m.persist(seller)
	}
}

// UpdatePrice updates the last known price for a symbol (for P&L calc)
func (m *Manager) UpdatePrice(symbol string, price float64) {
	m.mu.Lock()
	m.prices[symbol] = price
	m.mu.Unlock()
}

// Snapshot returns a full portfolio snapshot for a user
func (m *Manager) Snapshot(userID string) (*Snapshot, error) {
	p, err := m.Get(userID)
	if err != nil {
		return nil, err
	}
	m.mu.RLock()
	prices := make(map[string]float64, len(m.prices))
	for k, v := range m.prices {
		prices[k] = v
	}
	m.mu.RUnlock()

	snap := p.Snapshot(prices)
	return &snap, nil
}

// Leaderboard returns all users sorted by total portfolio value
type LeaderboardEntry struct {
	UserID     string  `json:"user_id"`
	Username   string  `json:"username"`
	TotalValue float64 `json:"total_value"`
	Cash       float64 `json:"cash"`
	PnL        float64 `json:"pnl"`
	Rank       int     `json:"rank"`
}

func (m *Manager) Leaderboard(usernames map[string]string) []LeaderboardEntry {
	m.mu.RLock()
	prices := make(map[string]float64, len(m.prices))
	for k, v := range m.prices {
		prices[k] = v
	}
	portfolios := make([]*Portfolio, 0, len(m.portfolios))
	for _, p := range m.portfolios {
		portfolios = append(portfolios, p)
	}
	m.mu.RUnlock()

	entries := make([]LeaderboardEntry, 0, len(portfolios))
	for _, p := range portfolios {
		// exclude system/bot accounts from leaderboard
		if p.UserID == "market_system" {
			continue
		}
		snap := p.Snapshot(prices)
		entries = append(entries, LeaderboardEntry{
			UserID:     p.UserID,
			Username:   usernames[p.UserID],
			TotalValue: snap.TotalValue,
			Cash:       snap.Cash,
			PnL:        snap.TotalValue - StartingCash,
		})
	}

	// sort by total value descending
	for i := 0; i < len(entries)-1; i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[j].TotalValue > entries[i].TotalValue {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}
	for i := range entries {
		entries[i].Rank = i + 1
	}
	return entries
}

func (m *Manager) persist(p *Portfolio) {
	p.mu.RLock()
	rec := &db.PortfolioRecord{
		UserID:      p.UserID,
		Cash:        p.Cash,
		RealizedPnL: p.RealizedPnL,
		Positions:   make(map[string]db.PositionRecord),
	}
	for sym, pos := range p.Positions {
		rec.Positions[sym] = db.PositionRecord{
			Quantity:      pos.Quantity,
			AvgEntryPrice: pos.AvgEntryPrice,
		}
	}
	p.mu.RUnlock()
	_ = db.UpsertPortfolio(rec)
}
