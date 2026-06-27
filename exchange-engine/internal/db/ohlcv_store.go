package db

// OHLCVRecord maps to the ohlcv_history table
type OHLCVRecord struct {
	Symbol   string
	Interval string
	Time     int64
	Open     float64
	High     float64
	Low      float64
	Close    float64
	Volume   float64
}

// InsertCandle persists a closed candle. Ignores duplicates (UNIQUE constraint).
func InsertCandle(r OHLCVRecord) error {
	_, err := DB.Exec(`
		INSERT OR IGNORE INTO ohlcv_history
		  (symbol, interval, time, open, high, low, close, volume)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Symbol, r.Interval, r.Time,
		r.Open, r.High, r.Low, r.Close, r.Volume,
	)
	return err
}

// GetCandles returns up to limit closed candles for a symbol/interval, oldest first.
func GetCandles(symbol, interval string, limit int) ([]OHLCVRecord, error) {
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	rows, err := DB.Query(`
		SELECT symbol, interval, time, open, high, low, close, volume
		FROM   ohlcv_history
		WHERE  symbol = ? AND interval = ?
		ORDER  BY time DESC
		LIMIT  ?`, symbol, interval, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []OHLCVRecord
	for rows.Next() {
		var r OHLCVRecord
		if err := rows.Scan(&r.Symbol, &r.Interval, &r.Time,
			&r.Open, &r.High, &r.Low, &r.Close, &r.Volume); err != nil {
			continue
		}
		result = append(result, r)
	}

	// reverse so oldest is first (chart expects ascending time)
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result, nil
}
