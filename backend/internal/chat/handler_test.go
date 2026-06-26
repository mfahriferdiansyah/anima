package chat

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
)

// sseEvent is one parsed server-sent event from the handler's response.
type sseEvent struct {
	name string // "" for unnamed (delta) events
	data string
}

func parseSSE(t *testing.T, body string) []sseEvent {
	t.Helper()
	var events []sseEvent
	for _, block := range strings.Split(strings.TrimSpace(body), "\n\n") {
		var ev sseEvent
		for _, line := range strings.Split(block, "\n") {
			if name, ok := strings.CutPrefix(line, "event: "); ok {
				ev.name = name
			}
			if data, ok := strings.CutPrefix(line, "data: "); ok {
				ev.data = data
			}
		}
		events = append(events, ev)
	}
	return events
}

func chatServer(t *testing.T, upstreamURL string) *httptest.Server {
	t.Helper()
	h := &Handler{LLM: llm.New("test-key", upstreamURL), DefaultModel: "test-model"}
	srv := httptest.NewServer(http.HandlerFunc(h.HandleChat))
	t.Cleanup(srv.Close)
	return srv
}

func TestHandleChat_StreamsDeltasInOrderThenDone(t *testing.T) {
	var upstreamBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, d := range []string{"Hello", " ", "world"} {
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", d)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)

	srv := chatServer(t, upstream.URL)
	reqBody := `{
		"name": "Aria",
		"transcript": [{"role": "user", "content": "hi"}],
		"context": [{"noteId": "note-1", "title": "Sister's wedding", "body": "The wedding was in May."}]
	}`
	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}

	body, _ := io.ReadAll(resp.Body)
	events := parseSSE(t, string(body))
	if len(events) != 4 {
		t.Fatalf("got %d events, want 4 (3 deltas + done): %#v", len(events), events)
	}
	for i, want := range []string{"Hello", " ", "world"} {
		var delta struct {
			Delta string `json:"delta"`
		}
		if err := json.Unmarshal([]byte(events[i].data), &delta); err != nil {
			t.Fatalf("event %d data %q: %v", i, events[i].data, err)
		}
		if events[i].name != "" || delta.Delta != want {
			t.Fatalf("event %d = %#v, want delta %q", i, events[i], want)
		}
	}
	if events[3].name != "done" {
		t.Fatalf("last event = %#v, want event: done", events[3])
	}

	// The system prompt must carry the backend-owned identity (named for the
	// owner), the context note, and the [[noteId]] citation instruction.
	var upstreamReq struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(upstreamBody, &upstreamReq); err != nil {
		t.Fatal(err)
	}
	system := upstreamReq.Messages[0]
	if system.Role != "system" {
		t.Fatalf("first message role = %q, want system", system.Role)
	}
	for _, want := range []string{"Aria", "[[note-1]]", "The wedding was in May.", "cite"} {
		if !strings.Contains(system.Content, want) {
			t.Fatalf("system prompt missing %q:\n%s", want, system.Content)
		}
	}
}

func TestHandleChat_UpstreamFailureEmitsErrorEvent(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
	}))
	t.Cleanup(upstream.Close)

	srv := chatServer(t, upstream.URL)
	resp, err := http.Post(srv.URL, "application/json",
		strings.NewReader(`{"name":"n","transcript":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	events := parseSSE(t, string(body))
	last := events[len(events)-1]
	if last.name != "error" {
		t.Fatalf("last event = %#v, want event: error", last)
	}
}

func TestHandleChat_EmptyTranscriptRejected(t *testing.T) {
	srv := chatServer(t, "http://127.0.0.1:0")
	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(`{"name":"n","transcript":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}

func TestHandleChat_ClientDisconnectCancelsUpstream(t *testing.T) {
	upstreamCancelled := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n")
		http.NewResponseController(w).Flush()
		select {
		case <-r.Context().Done():
			close(upstreamCancelled)
		case <-time.After(5 * time.Second):
		}
	}))
	t.Cleanup(upstream.Close)

	srv := chatServer(t, upstream.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, srv.URL,
		bytes.NewReader([]byte(`{"name":"n","transcript":[{"role":"user","content":"hi"}]}`)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// Read the first delta, then drop the connection.
	reader := bufio.NewReader(resp.Body)
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	cancel()

	select {
	case <-upstreamCancelled:
		// Upstream request context was cancelled — propagation works.
	case <-time.After(5 * time.Second):
		t.Fatal("upstream request was not cancelled after client disconnect")
	}
}
