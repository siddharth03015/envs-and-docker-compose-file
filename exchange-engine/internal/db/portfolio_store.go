package db

import (
	"database/sql"
	"encoding/json"
	"errors"
)

type PortfolioRecord struct {
	UserID      string
	Cash        float64
	Positions   map[string]PositionRecord
	RealizedPnL float64
}

type PositionRecord struct {
	Quantity      float64 `json:"quantity"`
	AvgEntryPrice float64 `json:"avg_entry_price"`
}

func UpsertPortfolio(p *PortfolioRecord) error {
	posJSON, err := json.Marshal(p.Positions)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`
		INSERT INTO portfolios (user_id, cash, positions, realized_pnl, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET
			cash         = excluded.cash,
			positions    = excluded.positions,
			realized_pnl = excluded.realized_pnl,
			updated_at   = CURRENT_TIMESTAMP
	`, p.UserID, p.Cash, string(posJSON), p.RealizedPnL)
	return err
}

func GetPortfolio(userID string) (*PortfolioRecord, error) {
	row := DB.QueryRow(
		`SELECT user_id, cash, positions, realized_pnl FROM portfolios WHERE user_id = ?`, userID,
	)
	var posJSON string
	p := &PortfolioRecord{}
	if err := row.Scan(&p.UserID, &p.Cash, &posJSON, &p.RealizedPnL); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	p.Positions = make(map[string]PositionRecord)
	_ = json.Unmarshal([]byte(posJSON), &p.Positions)
	return p, nil
}

func GetAllPortfolios() ([]*PortfolioRecord, error) {
	rows, err := DB.Query(`SELECT user_id, cash, positions, realized_pnl FROM portfolios`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*PortfolioRecord
	for rows.Next() {
		var posJSON string
		p := &PortfolioRecord{}
		if err := rows.Scan(&p.UserID, &p.Cash, &posJSON, &p.RealizedPnL); err != nil {
			continue
		}
		p.Positions = make(map[string]PositionRecord)
		_ = json.Unmarshal([]byte(posJSON), &p.Positions)
		result = append(result, p)
	}
	return result, nil
}
