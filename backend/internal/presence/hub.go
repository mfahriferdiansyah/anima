// Package presence is an ephemeral WebSocket relay for the multiplayer canvas.
//
// CUSTODY INVARIANT: nothing here is ever persisted or logged. Rooms exist in
// memory only while peers are connected; payloads carry cursors/labels/pings —
// never memory content. The vault (on Walrus) remains the only durable state.
package presence

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	maxMsgBytes   = 4 << 10 // cursors and pings are tiny; anything bigger is abuse
	writeTimeout  = 5 * time.Second
	maxRoomPeers  = 32
	pingInterval  = 30 * time.Second
)

type peer struct {
	conn *websocket.Conn
	send chan []byte
}

type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}
}

// Hub relays raw messages between peers of the same vault room.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func NewHub() *Hub {
	return &Hub{rooms: make(map[string]*room)}
}

// roomKey scopes a room to a single board: presence on one canvas never leaks to
// another canvas of the same vault. canvas defaults to "shared" for back-compat
// (a legacy ?vault= URL with no canvas lands in the shared room).
func roomKey(vault, canvas string) string {
	return vault + "|" + canvas
}

func (h *Hub) getRoom(key string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[key]
	if !ok {
		r = &room{peers: make(map[*peer]struct{})}
		h.rooms[key] = r
	}
	return r
}

func (h *Hub) dropRoomIfEmpty(key string, r *room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r.mu.Lock()
	empty := len(r.peers) == 0
	r.mu.Unlock()
	if empty {
		delete(h.rooms, key)
	}
}

// ServeHTTP upgrades GET /presence?vault=<id>&canvas=<canvasId> and relays until
// disconnect. canvas is optional and defaults to "shared".
func (h *Hub) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	vault := req.URL.Query().Get("vault")
	if vault == "" {
		http.Error(w, "vault query param required", http.StatusBadRequest)
		return
	}
	canvas := req.URL.Query().Get("canvas")
	if canvas == "" {
		canvas = "shared"
	}
	key := roomKey(vault, canvas)

	conn, err := websocket.Accept(w, req, &websocket.AcceptOptions{
		// browser + local MCP processes; payloads are non-sensitive by design
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMsgBytes)

	r := h.getRoom(key)
	p := &peer{conn: conn, send: make(chan []byte, 64)}

	r.mu.Lock()
	if len(r.peers) >= maxRoomPeers {
		r.mu.Unlock()
		conn.Close(websocket.StatusPolicyViolation, "room full")
		return
	}
	r.peers[p] = struct{}{}
	r.mu.Unlock()

	ctx, cancel := context.WithCancel(req.Context())
	defer func() {
		cancel()
		r.mu.Lock()
		delete(r.peers, p)
		r.mu.Unlock()
		h.dropRoomIfEmpty(key, r)
		conn.Close(websocket.StatusNormalClosure, "")
	}()

	// writer
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case msg, ok := <-p.send:
				if !ok {
					return
				}
				wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
				err := p.conn.Write(wctx, websocket.MessageText, msg)
				wcancel()
				if err != nil {
					cancel()
					return
				}
			case <-ticker.C:
				wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
				err := p.conn.Ping(wctx)
				wcancel()
				if err != nil {
					cancel()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// reader → broadcast to everyone else in the room
	for {
		_, msg, err := conn.Read(ctx)
		if err != nil {
			return
		}
		r.mu.Lock()
		for other := range r.peers {
			if other == p {
				continue
			}
			select {
			case other.send <- msg:
			default: // slow consumer: drop the frame, never block the room
			}
		}
		r.mu.Unlock()
	}
}
