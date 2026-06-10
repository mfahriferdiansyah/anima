package chat

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
)

// fakeCompletions emulates a non-streaming ChatCompletion endpoint, returning
// the next canned message content on each call.
func fakeCompletions(t *testing.T, contents []string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		content := contents[min(int(n)-1, len(contents)-1)]
		body, _ := json.Marshal(map[string]any{
			"id":      "cmpl-1",
			"object":  "chat.completion",
			"model":   "test-model",
			"choices": []map[string]any{{"index": 0, "finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": content}}},
		})
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func postDistill(t *testing.T, upstreamURL string) (int, string) {
	t.Helper()
	h := &Handler{LLM: llm.New("test-key", upstreamURL), DefaultModel: "test-model"}
	srv := httptest.NewServer(http.HandlerFunc(h.HandleDistill))
	t.Cleanup(srv.Close)

	resp, err := http.Post(srv.URL, "application/json",
		strings.NewReader(`{"transcript":[{"role":"user","content":"my sister got married in May, it was lovely"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, readAll(t, resp)
}

func readAll(t *testing.T, resp *http.Response) string {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestHandleDistill_ParsesWellFormedNotes(t *testing.T) {
	notesJSON := `{"notes":[{"title":"Sister married in May","body":"The user's sister got married in May 2026.","tags":["family","sister"],"links":[]}]}`
	upstream, calls := fakeCompletions(t, []string{notesJSON})

	status, body := postDistill(t, upstream.URL)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var out struct{ Notes []Note }
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Notes) != 1 || out.Notes[0].Title != "Sister married in May" {
		t.Fatalf("notes = %#v", out.Notes)
	}
	if calls.Load() != 1 {
		t.Fatalf("upstream called %d times, want 1", calls.Load())
	}
}

func TestHandleDistill_StripsCodeFences(t *testing.T) {
	fenced := "```json\n{\"notes\":[{\"title\":\"t\",\"body\":\"b\",\"tags\":[],\"links\":[]}]}\n```"
	upstream, _ := fakeCompletions(t, []string{fenced})

	status, body := postDistill(t, upstream.URL)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var out struct{ Notes []Note }
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Notes) != 1 {
		t.Fatalf("notes = %#v", out.Notes)
	}
}

func TestHandleDistill_MalformedRetriesOnceThenEmpty(t *testing.T) {
	upstream, calls := fakeCompletions(t, []string{"sorry, I cannot do JSON", "still not json"})

	status, body := postDistill(t, upstream.URL)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	if !strings.Contains(body, `"notes":[]`) {
		t.Fatalf("want empty notes array, got %s", body)
	}
	if calls.Load() != 2 {
		t.Fatalf("upstream called %d times, want exactly 2 (one retry)", calls.Load())
	}
}

func TestHandleDistill_MalformedThenValidRecovers(t *testing.T) {
	upstream, calls := fakeCompletions(t, []string{
		"garbage",
		`{"notes":[{"title":"t","body":"b","tags":["x"],"links":[]}]}`,
	})

	status, body := postDistill(t, upstream.URL)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var out struct{ Notes []Note }
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Notes) != 1 || out.Notes[0].Title != "t" {
		t.Fatalf("notes = %#v", out.Notes)
	}
	if calls.Load() != 2 {
		t.Fatalf("upstream called %d times, want 2", calls.Load())
	}
}

func TestHandleDistill_EmptyNotesIsNormal(t *testing.T) {
	upstream, _ := fakeCompletions(t, []string{`{"notes":[]}`})

	status, body := postDistill(t, upstream.URL)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	if !strings.Contains(body, `"notes":[]`) {
		t.Fatalf("want empty notes array (not null), got %s", body)
	}
}

func TestHandleDistill_EmptyTranscriptRejected(t *testing.T) {
	h := &Handler{LLM: llm.New("test-key", "http://127.0.0.1:0"), DefaultModel: "test-model"}
	srv := httptest.NewServer(http.HandlerFunc(h.HandleDistill))
	t.Cleanup(srv.Close)

	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(`{"transcript":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}
