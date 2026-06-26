package chat

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
)

func postDraft(t *testing.T, upstreamURL, body string) (int, string) {
	t.Helper()
	h := &Handler{LLM: llm.New("test-key", upstreamURL), DefaultModel: "test-model"}
	srv := httptest.NewServer(http.HandlerFunc(h.HandleDraft))
	t.Cleanup(srv.Close)
	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, readAll(t, resp)
}

const draftReqBody = `{"name":"Nova","context":[{"noteId":"n-demo","title":"Demo script","body":"Seven minutes, three beats."}],"calendar":[{"title":"Demo day","start":"2026-06-28T15:00:00Z","end":"2026-06-28T16:00:00Z"}]}`

// AE6: a request with calendar + related notes yields a full structured draft,
// and the composed prompt carries the backend identity, the draft task, and the
// calendar grounding.
func TestHandleDraft_ProducesPreparedNote(t *testing.T) {
	var upstreamBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamBody, _ = io.ReadAll(r.Body)
		content := `{"prepared":true,"title":"Demo day prep","body":"## Agenda\n- beat one","tags":["work"],"links":["n-demo"]}`
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"id": "cmpl-1", "object": "chat.completion", "model": "test-model",
			"choices": []map[string]any{{"index": 0, "finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": content}}},
		})
	}))
	t.Cleanup(upstream.Close)

	status, body := postDraft(t, upstream.URL, draftReqBody)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var d Draft
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatal(err)
	}
	if !d.Prepared || d.Title != "Demo day prep" || d.Body == "" {
		t.Fatalf("draft = %#v", d)
	}

	var upstreamReq struct {
		Messages []struct{ Content string } `json:"messages"`
	}
	if err := json.Unmarshal(upstreamBody, &upstreamReq); err != nil {
		t.Fatal(err)
	}
	system := upstreamReq.Messages[0].Content
	for _, want := range []string{"Nova", "prepare", "Demo day", "n-demo"} {
		if !strings.Contains(system, want) {
			t.Fatalf("draft system prompt missing %q:\n%s", want, system)
		}
	}
}

// AE3: when there is nothing to prepare, the response is prepared:false with the
// reason in `reason` and no sealable body.
func TestHandleDraft_NothingToPrepare(t *testing.T) {
	upstream, _ := fakeCompletions(t, []string{`{"prepared":false,"reason":"your calendar and notes are empty for now"}`})

	status, body := postDraft(t, upstream.URL, `{"name":"Nova","context":[]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var d Draft
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatal(err)
	}
	if d.Prepared {
		t.Fatalf("want prepared=false, got %#v", d)
	}
	if d.Body != "" {
		t.Fatalf("nothing-to-prepare must have no sealable body, got %q", d.Body)
	}
	if d.Reason == "" {
		t.Fatalf("reason should be present")
	}
}

func TestHandleDraft_MalformedRetriesOnceThenNotPrepared(t *testing.T) {
	upstream, calls := fakeCompletions(t, []string{"not json", "still not json"})

	status, body := postDraft(t, upstream.URL, draftReqBody)
	if status != http.StatusOK {
		t.Fatalf("status %d (must never 500): %s", status, body)
	}
	var d Draft
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatal(err)
	}
	if d.Prepared {
		t.Fatalf("malformed output should degrade to prepared=false, got %#v", d)
	}
	if calls.Load() != 2 {
		t.Fatalf("upstream called %d times, want exactly 2 (one retry)", calls.Load())
	}
}

// The widest-grounding handler must honor the no-log custody invariant: draft.go
// must not log request bodies, grounding, or output on any path.
func TestHandleDraft_HandlerDoesNotLog(t *testing.T) {
	src, err := os.ReadFile("draft.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), "log.") || strings.Contains(string(src), "\"log\"") {
		t.Fatal("draft.go must not log (custody invariant): found a log reference")
	}
}
