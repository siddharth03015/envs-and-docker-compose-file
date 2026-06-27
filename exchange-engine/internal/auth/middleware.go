package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const (
	CtxUserID   contextKey = "user_id"
	CtxUsername contextKey = "username"
)

// Middleware validates the Authorization: Bearer <token> header
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			http.Error(w, `{"error":"missing token"}`, http.StatusUnauthorized)
			return
		}
		claims, err := ValidateToken(token)
		if err != nil {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), CtxUserID, claims.UserID)
		ctx = context.WithValue(ctx, CtxUsername, claims.Username)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// OptionalMiddleware sets user context if token present, but does not reject missing tokens
func OptionalMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token != "" {
			if claims, err := ValidateToken(token); err == nil {
				ctx := context.WithValue(r.Context(), CtxUserID, claims.UserID)
				ctx = context.WithValue(ctx, CtxUsername, claims.Username)
				r = r.WithContext(ctx)
			}
		}
		next.ServeHTTP(w, r)
	})
}

func extractToken(r *http.Request) string {
	// try Authorization header
	header := r.Header.Get("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	// fallback: query param (for WebSocket connections)
	return r.URL.Query().Get("token")
}

func GetUserID(ctx context.Context) string {
	v, _ := ctx.Value(CtxUserID).(string)
	return v
}

func GetUsername(ctx context.Context) string {
	v, _ := ctx.Value(CtxUsername).(string)
	return v
}
