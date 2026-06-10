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
	_, res, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/presence", nil)
	if err == nil {
		t.Fatal("dial without vault should fail")
	}
	if res != nil && res.StatusCode != 400 {
		t.Fatalf("expected 400, got %d", res.StatusCode)
	}
}
