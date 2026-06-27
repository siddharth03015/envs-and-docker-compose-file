package broadcast

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 45 * time.Second
	maxMessageSize = 4096
	sendBufSize    = 256
)

func SendBufSize() int { return sendBufSize }

// Client represents one connected WebSocket user
type Client struct {
	Hub    *Hub
	Conn   *websocket.Conn
	Send   chan []byte
	UserID string
	Symbol string // currently subscribed symbol
	mu     sync.Mutex
}

func (c *Client) SetSymbol(s string) {
	c.mu.Lock()
	c.Symbol = s
	c.mu.Unlock()
}

func (c *Client) getSymbol() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Symbol
}

// WritePump pumps messages from the hub to the WebSocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ReadPump reads messages from the WebSocket and routes them
func (c *Client) ReadPump(handler func(client *Client, msg []byte)) {
	defer func() {
		c.Hub.Unregister(c)
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[ws] client %s error: %v", c.UserID, err)
			}
			break
		}
		handler(c, msg)
	}
}

// Hub manages all WebSocket clients
type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]bool
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*Client]bool)}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()
	log.Printf("[hub] client connected: %s (symbol: %s) total: %d", c.UserID, c.Symbol, h.ClientCount())
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.Send)
	}
	h.mu.Unlock()
	log.Printf("[hub] client disconnected: %s", c.UserID)
}

// BroadcastSymbol sends a message to all clients subscribed to a symbol
func (h *Hub) BroadcastSymbol(symbol string, v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.Symbol == symbol {
			h.sendTo(c, data)
		}
	}
}

// BroadcastAll sends a message to every connected client
func (h *Hub) BroadcastAll(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		h.sendTo(c, data)
	}
}

// SendToUser sends a message to a specific user (all their connections)
func (h *Hub) SendToUser(userID string, v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.UserID == userID {
			h.sendTo(c, data)
		}
	}
}

func (h *Hub) sendTo(c *Client, data []byte) {
	select {
	case c.Send <- data:
	default:
		// client is too slow — drop message, don't block engine
	}
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
