package presence

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return c
}

func TestRelayBetweenPeersSameRoom(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?vault=0xabc"

	a := dial(t, url)
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, url)
	defer b.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	msg := `{"t":"cursor","id":"a","x":10,"y":20}`
	if err := a.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, got, err := b.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != msg {
		t.Fatalf("relay mismatch: %s", got)
	}
}

func TestNoCrossRoomLeak(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	base := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?vault="

	a := dial(t, base+"0xaaa")
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, base+"0xbbb")
	defer b.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	if err := a.Write(ctx, websocket.MessageText, []byte(`{"t":"hello","id":"a"}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, _, err := b.Read(ctx); err == nil {
		t.Fatal("peer in a different vault room received the message")
	}
}

func TestDifferentCanvasesAreDifferentRooms(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	base := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?vault=0xabc&canvas="

	a := dial(t, base+"A")
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, base+"B")
	defer b.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	if err := a.Write(ctx, websocket.MessageText, []byte(`{"t":"hello","id":"a"}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, _, err := b.Read(ctx); err == nil {
		t.Fatal("peer on a different canvas of the same vault received the message")
	}
}

func TestNoCanvasSharesSharedRoom(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	base := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?vault=0xabc"

	a := dial(t, base)                  // legacy URL, no canvas → shared room
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, base+"&canvas=shared") // explicit shared room
	defer b.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	msg := `{"t":"cursor","id":"a","x":10,"y":20}`
	if err := a.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, got, err := b.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != msg {
		t.Fatalf("relay mismatch (no-canvas should default to shared): %s", got)
	}
}

func TestSenderDoesNotEcho(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?vault=0xself"

	a := dial(t, url)
	defer a.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	if err := a.Write(ctx, websocket.MessageText, []byte(`{"t":"cursor","id":"a","x":1,"y":1}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, _, err := a.Read(ctx); err == nil {
		t.Fatal("sender received its own message")
	}
}

func TestMissingVaultParamRejected(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// neither vault nor room → 400
	_, res, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/presence", nil)
	if err == nil {
		t.Fatal("dial without vault or room should fail")
	}
	if res != nil && res.StatusCode != 400 {
		t.Fatalf("expected 400, got %d", res.StatusCode)
	}
}

// 008 U1 — a share room is keyed by an unguessable ?room= id, not the vault id,
// so a peer knowing only the public vault id lands in a different room.
func TestShareRoomKeyedByRoomParam(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	wsBase := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence"

	// two participants who both know the unguessable room id share a room
	a := dial(t, wsBase+"?room=unguessable-xyz")
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, wsBase+"?room=unguessable-xyz")
	defer b.Close(websocket.StatusNormalClosure, "")
	// an eavesdropper who knows only the vault id is in a DIFFERENT room
	e := dial(t, wsBase+"?vault=unguessable-xyz&canvas=shared")
	defer e.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	msg := `{"t":"note-op","id":"a","noteId":"n1","body":"hi"}`
	if err := a.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
	// b (same room) receives it
	_, got, err := b.Read(ctx)
	if err != nil || string(got) != msg {
		t.Fatalf("share-room peer should receive content-op: got=%q err=%v", got, err)
	}
	// e (vault-id keyed room) must NOT receive it
	ectx, ecancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
	defer ecancel()
	if _, _, err := e.Read(ectx); err == nil {
		t.Fatal("a vault-id-only peer received a private share-room content-op")
	}
}

// 008 U1 — content-op frames bigger than the old 4 KB cap but under the new cap
// relay intact (live collaboration needs them).
func TestLargeContentFrameRelaysUnderCap(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?room=big"

	a := dial(t, url)
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, url)
	defer b.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	body := strings.Repeat("x", 8<<10) // 8 KB body — over the old 4 KB cap
	msg := `{"t":"note-op","id":"a","noteId":"n1","body":"` + body + `"}`
	if err := a.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, got, err := b.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != msg {
		t.Fatalf("large content-op not relayed intact (%d bytes got)", len(got))
	}
}

// 008 U1 — a frame past the cap drops only the sender; the room keeps relaying.
func TestOversizeFrameDropsSenderNotRoom(t *testing.T) {
	srv := httptest.NewServer(NewHub())
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?room=oc"

	a := dial(t, url)
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, url)
	defer b.Close(websocket.StatusNormalClosure, "")
	c := dial(t, url)
	defer c.Close(websocket.StatusNormalClosure, "")

	// a sends a frame past the 64 KB read cap → the hub drops a's connection
	// (the oversized frame is never relayed) without disturbing the room.
	wctx, wcancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer wcancel()
	_ = a.Write(wctx, websocket.MessageText, []byte(strings.Repeat("y", 70<<10)))

	// the room survives: b → c still relays a normal frame
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	msg := `{"t":"cursor","id":"b","x":3,"y":3}`
	if err := b.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, got, err := c.Read(ctx); err != nil || string(got) != msg {
		t.Fatalf("room should survive an oversized frame: got=%q err=%v", got, err)
	}
}

// 008 U1 — the per-IP connection cap refuses a flood; existing peers are
// unaffected.
func TestPerIPConnectionCap(t *testing.T) {
	h := NewHub()
	h.maxConnsPerIP = 2
	srv := httptest.NewServer(h)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence?room=cap"

	a := dial(t, url)
	defer a.Close(websocket.StatusNormalClosure, "")
	b := dial(t, url)
	defer b.Close(websocket.StatusNormalClosure, "")

	// the 3rd connection from the same IP is refused (429)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, res, err := websocket.Dial(ctx, url, nil)
	if err == nil {
		t.Fatal("connection past the per-IP cap should be refused")
	}
	if res != nil && res.StatusCode != 429 {
		t.Fatalf("expected 429, got %d", res.StatusCode)
	}

	// the two existing peers still relay
	relayCtx, relayCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer relayCancel()
	msg := `{"t":"cursor","id":"a","x":1,"y":1}`
	if err := a.Write(relayCtx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, got, err := b.Read(relayCtx); err != nil || string(got) != msg {
		t.Fatalf("existing peers should be unaffected by the cap: got=%q err=%v", got, err)
	}
}

// 008 U1 — the global room ceiling refuses a NEW room; existing rooms keep working.
func TestGlobalRoomCeiling(t *testing.T) {
	h := NewHub()
	h.maxRooms = 1
	srv := httptest.NewServer(h)
	defer srv.Close()
	wsBase := "ws" + strings.TrimPrefix(srv.URL, "http") + "/presence"

	// room A is the one allowed room
	a1 := dial(t, wsBase+"?room=A")
	defer a1.Close(websocket.StatusNormalClosure, "")
	a2 := dial(t, wsBase+"?room=A") // joins the EXISTING room (no new room)
	defer a2.Close(websocket.StatusNormalClosure, "")

	// a connection that would create a SECOND room is closed
	b := dial(t, wsBase+"?room=B")
	defer b.Close(websocket.StatusNormalClosure, "")
	bctx, bcancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer bcancel()
	if _, _, err := b.Read(bctx); err == nil {
		t.Fatal("a connection past the room ceiling should be closed")
	}

	// room A is unaffected
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	msg := `{"t":"cursor","id":"a","x":2,"y":2}`
	if err := a1.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, got, err := a2.Read(ctx); err != nil || string(got) != msg {
		t.Fatalf("existing room should be unaffected by the ceiling: got=%q err=%v", got, err)
	}
}
