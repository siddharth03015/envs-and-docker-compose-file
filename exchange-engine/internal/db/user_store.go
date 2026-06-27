package db

import (
	"database/sql"
	"errors"
	"strings"
)

type User struct {
	ID       string
	Username string
	Password string // bcrypt hash
}

var ErrUserNotFound = errors.New("user not found")
var ErrUserExists = errors.New("username already taken")

func CreateUser(u *User) error {
	_, err := DB.Exec(
		`INSERT INTO users (id, username, password) VALUES (?, ?, ?)`,
		u.ID, u.Username, u.Password,
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return ErrUserExists
	}
	return err
}

func GetUserByUsername(username string) (*User, error) {
	row := DB.QueryRow(`SELECT id, username, password FROM users WHERE username = ?`, username)
	u := &User{}
	if err := row.Scan(&u.ID, &u.Username, &u.Password); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return u, nil
}

func GetUserByID(id string) (*User, error) {
	row := DB.QueryRow(`SELECT id, username, password FROM users WHERE id = ?`, id)
	u := &User{}
	if err := row.Scan(&u.ID, &u.Username, &u.Password); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return u, nil
}
