// Package presence is an ephemeral WebSocket relay for the multiplayer canvas
// and live shared-doc collaboration.
//
// CUSTODY INVARIANT: nothing here is written to disk, logged, or parsed for
// content. The relay inspects exactly ONE frame — `room-state` — of which it
// keeps a single bounded, in-memory, TTL'd copy per room so a guest joining can
// hydrate the current scene even when the owner is offline. That snapshot is
// ephemeral (RAM only, GC'd shortly after the room empties) and is the same
// plaintext the relay already fans out live. During an ACTIVE SHARE the relay
// fans out plaintext note/canvas content-op frames between the participants —
// authorized by the share, never durable, never disk-backed — so the relay is
// explicitly NOT a confidentiality trust boundary for shared content (disclosed
// in the docs). It holds no key, signs nothing, and the vault (sealed on Walrus)
// remains the only DURABLE state. Private (unshared) editing emits no
// content-ops; share rooms are keyed by an unguessable id, not the public vault
// id, so a vault-id holder cannot eavesdrop a private session.
package presence

import (
	"bytes"
	"context"
	"encoding/json"
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

	// Room snapshot (room-state) bounds. A room keeps its last snapshot for
	// roomTTL after the last peer leaves, so reopening a share within the window
	// resumes seamlessly; the janitor then GCs it. maxSnapshotBytes caps the held
	// copy (worst case maxRooms × maxSnapshotBytes ≈ 224 MB).
	defaultRoomTTL        = 5 * time.Minute
	defaultRoomGCInterval = 30 * time.Second
	maxSnapshotBytes      = 56 << 10
)

type peer struct {
	conn *websocket.Conn
	send chan []byte
}

type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}

	// snapshot is the last room-state frame (raw text), handed to every new
	// joiner; snapshotSeq is its monotonic version (only a newer one replaces it).
	snapshot    []byte
	snapshotSeq uint64
	// emptyAt is when the last peer left (zero while occupied); the janitor GCs a
	// room that has stayed empty past roomTTL, freeing its snapshot.
	emptyAt time.Time
}

// Hub relays raw messages between peers of the same room.
type Hub struct {
	mu        sync.Mutex
	rooms     map[string]*room
	connsByIP map[string]int

	// DoS bounds — fields (not consts) so tests can lower them.
	maxConnsPerIP int
	maxRooms      int

	// Snapshot-room lifetime — fields so tests can shrink them.
	roomTTL        time.Duration
	roomGCInterval time.Duration
}

func NewHub() *Hub {
	h := &Hub{
		rooms:          make(map[string]*room),
		connsByIP:      make(map[string]int),
		maxConnsPerIP:  defaultMaxConnsPerIP,
		maxRooms:       defaultMaxRooms,
		roomTTL:        defaultRoomTTL,
		roomGCInterval: defaultRoomGCInterval,
	}
	go h.janitor()
	return h
}

// janitor periodically frees rooms (and their snapshots) that have stayed empty
// past roomTTL. The actual eviction is sweep(), exposed so tests drive it
// directly instead of waiting on the ticker.
func (h *Hub) janitor() {
	for {
		h.mu.Lock()
		iv := h.roomGCInterval
		h.mu.Unlock()
		time.Sleep(iv)
		h.sweep()
	}
}

// sweep deletes every room that is empty and has been so for longer than roomTTL.
func (h *Hub) sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	cutoff := time.Now().Add(-h.roomTTL)
	for key, r := range h.rooms {
		r.mu.Lock()
		stale := len(r.peers) == 0 && !r.emptyAt.IsZero() && r.emptyAt.Before(cutoff)
		r.mu.Unlock()
		if stale {
			delete(h.rooms, key)
		}
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
		// Re-occupied: clear the empty marker so the janitor won't GC it out from
		// under the joiner (and so its snapshot keeps serving new arrivals).
		r.mu.Lock()
		r.emptyAt = time.Time{}
		r.mu.Unlock()
		return r
	}
	if len(h.rooms) >= h.maxRooms {
		return nil
	}
	r = &room{peers: make(map[*peer]struct{})}
	h.rooms[key] = r
	return r
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
	// Hand the joiner the room's current snapshot (if any) BEFORE the reader loop,
	// so it hydrates the saved scene regardless of who else — including the owner —
	// is connected. This is the whole point of holding room state.
	if r.snapshot != nil {
		snap := r.snapshot
		select {
		case p.send <- snap:
		default:
		}
	}
	r.mu.Unlock()

	ctx, cancel := context.WithCancel(req.Context())
	defer func() {
		cancel()
		r.mu.Lock()
		delete(r.peers, p)
		if len(r.peers) == 0 {
			// Keep the room (and its snapshot) for roomTTL; the janitor GCs it.
			r.emptyAt = time.Now()
		}
		r.mu.Unlock()
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
		// room-state is the ONE frame the relay stores rather than relays: keep the
		// newest (by seq) as the catch-up snapshot for future joiners. Cheap guard
		// first so the hot path never unmarshals an ordinary frame.
		if seq, ok := roomStateSeq(msg); ok {
			if len(msg) <= maxSnapshotBytes {
				r.mu.Lock()
				if seq > r.snapshotSeq {
					r.snapshotSeq = seq
					r.snapshot = append([]byte(nil), msg...) // copy: conn.Read reuses its buffer
				}
				r.mu.Unlock()
			}
			continue // never broadcast the snapshot frame itself
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

// roomStateSeq reports whether msg is a room-state frame and, if so, its seq. The
// bytes.Contains guard keeps the common case (any other frame) from unmarshaling.
func roomStateSeq(msg []byte) (uint64, bool) {
	head := msg
	if len(head) > 64 {
		head = head[:64]
	}
	if !bytes.Contains(head, []byte(`"room-state"`)) {
		return 0, false
	}
	var env struct {
		T   string `json:"t"`
		Seq uint64 `json:"seq"`
	}
	if json.Unmarshal(msg, &env) != nil || env.T != "room-state" {
		return 0, false
	}
	return env.Seq, true
}
