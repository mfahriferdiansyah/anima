package llm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// fakeUpstream emulates an OpenAI-compatible streaming endpoint and records
// the headers it received.
func fakeUpstream(t *testing.T, deltas []string) (*httptest.Server, *http.Header) {
	t.Helper()
	var gotHeaders http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		gotHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "text/event-stream")
		for _, d := range deltas {
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", d)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)
	return srv, &gotHeaders
}

func collect(t *testing.T, ch <-chan StreamChunk) (deltas []string, done bool, err error) {
	t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case chunk, ok := <-ch:
			if !ok {
				return deltas, done, err
			}
			switch {
			case chunk.Err != nil:
				err = chunk.Err
			case chunk.Done:
				done = true
			default:
				deltas = append(deltas, chunk.Delta)
			}
		case <-timeout:
			t.Fatal("timed out waiting for stream chunks")
		}
	}
}

func TestStreamChat_DeltasInOrderThenDone(t *testing.T) {
	srv, headers := fakeUpstream(t, []string{"Hello", " ", "world"})
	client := New("test-key", srv.URL)

	ch, err := client.StreamChat(context.Background(), "test-model", []Message{{Role: "user", Content: "hi"}})
	if err != nil {
		t.Fatal(err)
	}
	deltas, done, streamErr := collect(t, ch)
	if streamErr != nil {
		t.Fatalf("stream error: %v", streamErr)
	}
	if !done {
		t.Fatal("missing Done chunk")
	}
	if want := []string{"Hello", " ", "world"}; len(deltas) != len(want) || deltas[0] != "Hello" || deltas[1] != " " || deltas[2] != "world" {
		t.Fatalf("deltas = %q, want %q", deltas, want)
	}

	// OpenRouter attribution headers must be present on every request.
	if got := headers.Get("HTTP-Referer"); got == "" {
		t.Fatal("missing HTTP-Referer header")
	}
	if got := headers.Get("X-OpenRouter-Title"); got != "ANIMA" {
		t.Fatalf("X-OpenRouter-Title = %q, want ANIMA", got)
	}
	if got := headers.Get("Authorization"); got != "Bearer test-key" {
		t.Fatalf("Authorization = %q, want Bearer test-key", got)
	}
}

func TestStreamChat_UpstreamErrorSurfacesOnChannel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream exploded", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	client := New("test-key", srv.URL)

	ch, err := client.StreamChat(context.Background(), "test-model", []Message{{Role: "user", Content: "hi"}})
	if err != nil {
		t.Fatal(err)
	}
	deltas, done, streamErr := collect(t, ch)
	if streamErr == nil {
		t.Fatal("expected an error chunk")
	}
	if done || len(deltas) != 0 {
		t.Fatalf("expected error-only stream, got deltas=%q done=%v", deltas, done)
	}
}

func TestStreamChat_EmptyModelRejected(t *testing.T) {
	client := New("test-key", "http://127.0.0.1:0")
	if _, err := client.StreamChat(context.Background(), "", nil); err == nil {
		t.Fatal("expected error for empty model")
	}
}
