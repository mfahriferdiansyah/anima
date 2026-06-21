// Package presence is an ephemeral WebSocket relay for the multiplayer canvas
// and live shared-doc collaboration.
//
// CUSTODY INVARIANT: nothing here is ever persisted, logged, or parsed. Rooms
// exist in memory only while peers are connected. During an ACTIVE SHARE the
// relay also fans out plaintext note/canvas content-op frames between the
// participants — authorized by the share, never durable, never inspected — so
// the relay is explicitly NOT a confidentiality trust boundary for shared
// content (disclosed in the docs). It still holds no key, signs nothing, and the
// vault (sealed on Walrus) remains the only durable state. Private (unshared)
// editing emits no content-ops; share rooms are keyed by an unguessable id, not
// the public vault id, so a vault-id holder cannot eavesdrop a private session.
package presence

import (
	"context"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	// Content-op frames (a note-body snapshot, a canvas op) are larger than a
	// cursor ping but still bounded; anything past this cap is abuse.
	maxMsgBytes  = 64 << 10
	writeTimeout = 5 * time.Second
	maxRoomPeers = 32
	pingInterval = 30 * time.Second

	// DoS bounds (overridable per-Hub for tests). Generous for real use; they
	// only bite a flood.
	defaultMaxConnsPerIP = 24   // one client opens a handful of tabs/agents
	defaultMaxRooms      = 4096 // global ceiling on concurrent rooms
)

type peer struct {
	conn *websocket.Conn
	send chan []byte
}

type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}
}

// Hub relays raw messages between peers of the same room.
type Hub struct {
	mu        sync.Mutex
	rooms     map[string]*room
	connsByIP map[string]int

	// DoS bounds — fields (not consts) so tests can lower them.
	maxConnsPerIP int
	maxRooms      int
}

func NewHub() *Hub {
	return &Hub{
		rooms:         make(map[string]*room),
		connsByIP:     make(map[string]int),
		maxConnsPerIP: defaultMaxConnsPerIP,
		maxRooms:      defaultMaxRooms,
	}
}

// roomKey scopes a room to a single board: presence on one canvas never leaks to
// another canvas of the same vault. canvas defaults to "shared" for back-compat
// (a legacy ?vault= URL with no canvas lands in the shared room).
func roomKey(vault, canvas string) string {
	return vault + "|" + canvas
}

// reserveConn admits one connection from ip if it is under the per-IP cap.
func (h *Hub) reserveConn(ip string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.connsByIP[ip] >= h.maxConnsPerIP {
		return false
	}
	h.connsByIP[ip]++
	return true
}

func (h *Hub) releaseConn(ip string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.connsByIP[ip] <= 1 {
		delete(h.connsByIP, ip)
		return
	}
	h.connsByIP[ip]--
}

// getRoom returns the room for key, creating it if absent. A NEW room is refused
// (nil) once the global ceiling is hit — existing rooms are never affected.
func (h *Hub) getRoom(key string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[key]
	if ok {
		return r
	}
	if len(h.rooms) >= h.maxRooms {
		return nil
	}
	r = &room{peers: make(map[*peer]struct{})}
	h.rooms[key] = r
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

func clientIP(req *http.Request) string {
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}

// ServeHTTP upgrades GET /presence and relays until disconnect. A normal canvas
// peer connects with ?vault=<id>&canvas=<canvasId> (canvas defaults to "shared");
// a live share participant connects with ?room=<unguessable-id>, which keys the
// room directly so it is not derivable from the public vault id. Either vault or
// room is required.
func (h *Hub) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	q := req.URL.Query()
	var key string
	if shareRoom := q.Get("room"); shareRoom != "" {
		// unguessable share-room id (008): the relay never maps it to a vault.
		key = shareRoom
	} else {
		vault := q.Get("vault")
		if vault == "" {
			http.Error(w, "vault or room query param required", http.StatusBadRequest)
			return
		}
		canvas := q.Get("canvas")
		if canvas == "" {
			canvas = "shared"
		}
		key = roomKey(vault, canvas)
	}

	// per-IP DoS bound — refuse before the upgrade so a flood is cheap to shed.
	ip := clientIP(req)
	if !h.reserveConn(ip) {
		http.Error(w, "too many connections", http.StatusTooManyRequests)
		return
	}
	defer h.releaseConn(ip)

	conn, err := websocket.Accept(w, req, &websocket.AcceptOptions{
		// browser + local MCP processes; payloads are non-sensitive by design
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMsgBytes)

	r := h.getRoom(key)
	if r == nil {
		conn.Close(websocket.StatusPolicyViolation, "server at room capacity")
		return
	}
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
