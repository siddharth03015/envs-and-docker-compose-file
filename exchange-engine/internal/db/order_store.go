package db

import "time"

// OpenOrderRecord maps to the open_orders table
type OpenOrderRecord struct {
	ID        string
	UserID    string
	Symbol    string
	Side      string
	Type      string
	Price     float64
	StopPrice float64
	Quantity  float64
	Filled    float64
	Status    string
	CreatedAt time.Time
}

// UpsertOpenOrder inserts or replaces an open order (called on submit)
func UpsertOpenOrder(r OpenOrderRecord) error {
	_, err := DB.Exec(`
		INSERT OR REPLACE INTO open_orders
		  (id, user_id, symbol, side, type, price, stop_price, quantity, filled, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.UserID, r.Symbol, r.Side, r.Type,
		r.Price, r.StopPrice, r.Quantity, r.Filled, r.Status, r.CreatedAt,
	)
	return err
}

// UpdateOpenOrderFill updates filled quantity and status for a partially/fully filled order
func UpdateOpenOrderFill(orderID string, filled float64, status string) error {
	_, err := DB.Exec(`
		UPDATE open_orders SET filled = ?, status = ? WHERE id = ?`,
		filled, status, orderID,
	)
	return err
}

// DeleteOpenOrder removes an order (called on full fill or cancel)
func DeleteOpenOrder(orderID string) error {
	_, err := DB.Exec(`DELETE FROM open_orders WHERE id = ?`, orderID)
	return err
}

// GetOpenOrdersByUser returns all open/partial orders for a user
func GetOpenOrdersByUser(userID string) ([]OpenOrderRecord, error) {
	rows, err := DB.Query(`
		SELECT id, user_id, symbol, side, type, price, stop_price, quantity, filled, status, created_at
		FROM   open_orders
		WHERE  user_id = ? AND status IN ('OPEN', 'PARTIAL')
		ORDER  BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOpenOrders(rows)
}

// GetAllOpenOrders returns every open/partial order (for restart recovery)
func GetAllOpenOrders() ([]OpenOrderRecord, error) {
	rows, err := DB.Query(`
		SELECT id, user_id, symbol, side, type, price, stop_price, quantity, filled, status, created_at
		FROM   open_orders
		WHERE  status IN ('OPEN', 'PARTIAL')
		ORDER  BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOpenOrders(rows)
}

func scanOpenOrders(rows interface {
	Next() bool
	Scan(...interface{}) error
	Close() error
}) ([]OpenOrderRecord, error) {
	defer rows.Close()
	var result []OpenOrderRecord
	for rows.Next() {
		var r OpenOrderRecord
		var ts string
		if err := rows.Scan(&r.ID, &r.UserID, &r.Symbol, &r.Side, &r.Type,
			&r.Price, &r.StopPrice, &r.Quantity, &r.Filled, &r.Status, &ts); err != nil {
			continue
		}
		r.CreatedAt, _ = time.Parse("2006-01-02T15:04:05Z07:00", ts)
		if r.CreatedAt.IsZero() {
			r.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", ts)
		}
		result = append(result, r)
	}
	return result, nil
}
