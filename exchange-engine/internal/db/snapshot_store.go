package db

import "time"

// SnapshotRecord maps to the portfolio_snapshots table
type SnapshotRecord struct {
	UserID        string
	TotalValue    float64
	Cash          float64
	RealizedPnL   float64
	UnrealizedPnL float64
	Timestamp     time.Time
}

// InsertSnapshot saves a portfolio value snapshot for the P&L equity curve
func InsertSnapshot(r SnapshotRecord) error {
	_, err := DB.Exec(`
		INSERT INTO portfolio_snapshots
		  (user_id, total_value, cash, realized_pnl, unrealized_pnl, timestamp)
		VALUES (?, ?, ?, ?, ?, ?)`,
		r.UserID, r.TotalValue, r.Cash, r.RealizedPnL, r.UnrealizedPnL, r.Timestamp,
	)
	return err
}

// GetPnLHistory returns the portfolio equity curve for a user, oldest first
func GetPnLHistory(userID string, limit int) ([]SnapshotRecord, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := DB.Query(`
		SELECT user_id, total_value, cash, realized_pnl, unrealized_pnl, timestamp
		FROM   portfolio_snapshots
		WHERE  user_id = ?
		ORDER  BY timestamp DESC
		LIMIT  ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SnapshotRecord
	for rows.Next() {
		var r SnapshotRecord
		var ts string
		if err := rows.Scan(&r.UserID, &r.TotalValue, &r.Cash,
			&r.RealizedPnL, &r.UnrealizedPnL, &ts); err != nil {
			continue
		}
		r.Timestamp, _ = time.Parse("2006-01-02T15:04:05Z07:00", ts)
		if r.Timestamp.IsZero() {
			r.Timestamp, _ = time.Parse("2006-01-02 15:04:05", ts)
		}
		result = append(result, r)
	}

	// reverse to oldest-first for frontend chart
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result, nil
}
