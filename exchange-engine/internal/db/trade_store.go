package db

import "time"

const systemUser = "market_system"

// TradeRecord maps to the trade_history table
type TradeRecord struct {
	ID            string
	Symbol        string
	BuyerID       string
	SellerID      string
	Price         float64
	Quantity      float64
	AggressorSide string
	Timestamp     time.Time
}

// IsHumanTrade returns true if at least one side is a real user (not the market system)
func IsHumanTrade(buyerID, sellerID string) bool {
	return buyerID != systemUser || sellerID != systemUser
}

// InsertTrade persists a trade. Only call this for human trades.
func InsertTrade(r TradeRecord) error {
	_, err := DB.Exec(`
		INSERT OR IGNORE INTO trade_history
		  (id, symbol, buyer_id, seller_id, price, quantity, aggressor_side, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.Symbol, r.BuyerID, r.SellerID,
		r.Price, r.Quantity, r.AggressorSide, r.Timestamp,
	)
	return err
}

// GetUserTrades returns a user's trade history (as buyer or seller), newest first
func GetUserTrades(userID string, limit int) ([]TradeRecord, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := DB.Query(`
		SELECT id, symbol, buyer_id, seller_id, price, quantity, aggressor_side, timestamp
		FROM   trade_history
		WHERE  buyer_id = ? OR seller_id = ?
		ORDER  BY timestamp DESC
		LIMIT  ?`, userID, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTrades(rows)
}

// GetSymbolTrades returns recent trades for a symbol, newest first
func GetSymbolTrades(symbol string, limit int) ([]TradeRecord, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := DB.Query(`
		SELECT id, symbol, buyer_id, seller_id, price, quantity, aggressor_side, timestamp
		FROM   trade_history
		WHERE  symbol = ?
		ORDER  BY timestamp DESC
		LIMIT  ?`, symbol, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTrades(rows)
}

func scanTrades(rows interface{ Next() bool; Scan(...interface{}) error; Close() error }) ([]TradeRecord, error) {
	defer rows.Close()
	var result []TradeRecord
	for rows.Next() {
		var r TradeRecord
		var ts string
		if err := rows.Scan(&r.ID, &r.Symbol, &r.BuyerID, &r.SellerID,
			&r.Price, &r.Quantity, &r.AggressorSide, &ts); err != nil {
			continue
		}
		r.Timestamp, _ = time.Parse("2006-01-02T15:04:05Z07:00", ts)
		if r.Timestamp.IsZero() {
			r.Timestamp, _ = time.Parse("2006-01-02 15:04:05", ts)
		}
		result = append(result, r)
	}
	return result, nil
}
