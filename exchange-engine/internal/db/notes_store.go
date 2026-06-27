package db

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// NoteRecord maps to the notes table.
type NoteRecord struct {
	ID        string
	UserID    string
	Content   string
	CreatedAt time.Time
}

// InsertNote creates a note and returns the full record so callers don't need
// a second round-trip to get the canonical created_at.
func InsertNote(userID string, content string) (NoteRecord, error) {
	noteID    := uuid.New().String()
	createdMs := time.Now().UnixMilli()

	_, err := DB.Exec(`
		INSERT INTO notes (id, user_id, content, created_at)
		VALUES (?, ?, ?, ?)`,
		noteID, userID, content, createdMs,
	)
	if err != nil {
		return NoteRecord{}, err
	}

	return NoteRecord{
		ID:        noteID,
		UserID:    userID,
		Content:   content,
		CreatedAt: time.UnixMilli(createdMs),
	}, nil
}

// GetNotesByUserRange returns notes for a user, optionally filtered by time.
// from is inclusive, to is exclusive. Both are Unix milliseconds; nil = unbounded.
func GetNotesByUserRange(userID string, from, to *time.Time) ([]NoteRecord, error) {
	query := `
		SELECT id, user_id, content, created_at
		FROM notes
		WHERE user_id = ?`

	args := []any{userID}

	if from != nil {
		query += " AND created_at >= ?"
		args = append(args, from.UnixMilli()) // compare integers
	}

	if to != nil {
		query += " AND created_at < ?"
		args = append(args, to.UnixMilli()) // compare integers
	}

	query += " ORDER BY created_at DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	return scanNotes(rows)
}

// UpdateNote updates a note's content.
// Returns sql.ErrNoRows if the note doesn't exist or belongs to a different user.
func UpdateNote(noteID string, userID string, content string) error {
	result, err := DB.Exec(`
		UPDATE notes
		SET content = ?
		WHERE id = ? AND user_id = ?`,
		content, noteID, userID,
	)
	if err != nil {
		return err
	}

	n, _ := result.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteNote deletes a note.
// Returns sql.ErrNoRows if the note doesn't exist or belongs to a different user.
func DeleteNote(noteID string, userID string) error {
	result, err := DB.Exec(`
		DELETE FROM notes
		WHERE id = ? AND user_id = ?`,
		noteID, userID,
	)
	if err != nil {
		return err
	}

	n, _ := result.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func scanNotes(rows interface {
	Next() bool
	Scan(...interface{}) error
	Close() error
}) ([]NoteRecord, error) {
	defer rows.Close()

	var result []NoteRecord
	for rows.Next() {
		var r NoteRecord
		var createdMs int64

		if err := rows.Scan(&r.ID, &r.UserID, &r.Content, &createdMs); err != nil {
			continue
		}

		r.CreatedAt = time.UnixMilli(createdMs)
		result = append(result, r)
	}

	return result, nil
}
