package chat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
)

// fakeCompletions and readAll are defined in distill_test.go (same package).

func postSuggest(t *testing.T, upstreamURL string, body string) (int, string) {
	t.Helper()
	h := &Handler{LLM: llm.New("test-key", upstreamURL), DefaultModel: "test-model"}
	srv := httptest.NewServer(http.HandlerFunc(h.HandleSuggest))
	t.Cleanup(srv.Close)

	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, readAll(t, resp)
}

const validSuggestBody = `{"persona":"You are Nova.","context":[{"noteId":"n-demo","title":"Demo script","body":"Seven minutes, three beats.","tags":["work"]}]}`

func TestHandleSuggest_ParsesWellFormedSuggestions(t *testing.T) {
	suggestJSON := `{"suggestions":[{"title":"Draft the demo day slides","body":"Open your demo script and draft the slide deck now — seven minutes needs visuals.","tags":["work"],"links":["n-demo"]}]}`
	upstream, calls := fakeCompletions(t, []string{suggestJSON})

	status, body := postSuggest(t, upstream.URL, validSuggestBody)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var out struct{ Suggestions []Note }
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Suggestions) != 1 || out.Suggestions[0].Title != "Draft the demo day slides" {
		t.Fatalf("suggestions = %#v", out.Suggestions)
	}
	if calls.Load() != 1 {
		t.Fatalf("upstream called %d times, want 1", calls.Load())
	}
}

func TestHandleSuggest_StripsCodeFences(t *testing.T) {
	fenced := "```json\n{\"suggestions\":[{\"title\":\"t\",\"body\":\"b\",\"tags\":[],\"links\":[]}]}\n```"
	upstream, _ := fakeCompletions(t, []string{fenced})

	status, body := postSuggest(t, upstream.URL, validSuggestBody)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var out struct{ Suggestions []Note }
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Suggestions) != 1 {
		t.Fatalf("suggestions = %#v", out.Suggestions)
	}
}

func TestHandleSuggest_MalformedRetriesOnceThenEmpty(t *testing.T) {
	upstream, calls := fakeCompletions(t, []string{"sorry, not JSON", "still broken"})

	status, body := postSuggest(t, upstream.URL, validSuggestBody)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	if !strings.Contains(body, `"suggestions":[]`) {
		t.Fatalf("want empty suggestions array, got %s", body)
	}
	if calls.Load() != 2 {
		t.Fatalf("upstream called %d times, want exactly 2 (one retry)", calls.Load())
	}
}

func TestHandleSuggest_MalformedThenValidRecovers(t *testing.T) {
	upstream, calls := fakeCompletions(t, []string{
		"garbage",
		`{"suggestions":[{"title":"t","body":"b","tags":["x"],"links":[]}]}`,
	})

	status, body := postSuggest(t, upstream.URL, validSuggestBody)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var out struct{ Suggestions []Note }
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Suggestions) != 1 || out.Suggestions[0].Title != "t" {
		t.Fatalf("suggestions = %#v", out.Suggestions)
	}
	if calls.Load() != 2 {
		t.Fatalf("upstream called %d times, want 2", calls.Load())
	}
}

func TestHandleSuggest_EmptySuggestionsIsNormal(t *testing.T) {
	upstream, _ := fakeCompletions(t, []string{`{"suggestions":[]}`})

	status, body := postSuggest(t, upstream.URL, validSuggestBody)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	if !strings.Contains(body, `"suggestions":[]`) {
		t.Fatalf("want empty suggestions array (not null), got %s", body)
	}
}

func TestHandleSuggest_EmptyBodyRejected(t *testing.T) {
	h := &Handler{LLM: llm.New("test-key", "http://127.0.0.1:0"), DefaultModel: "test-model"}
	srv := httptest.NewServer(http.HandlerFunc(h.HandleSuggest))
	t.Cleanup(srv.Close)

	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(`}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}

func TestHandleSuggest_EmptyContextIsValid(t *testing.T) {
	// An empty context is legal — the vault may be new.
	upstream, _ := fakeCompletions(t, []string{`{"suggestions":[]}`})
	status, _ := postSuggest(t, upstream.URL, `{"persona":"Nova","context":[]}`)
	if status != http.StatusOK {
		t.Fatalf("status %d, want 200", status)
	}
}

func TestHandleSuggest_WithCalendarEvents(t *testing.T) {
	suggestJSON := `{"suggestions":[{"title":"Prep for Lisbon call","body":"Review your trip plan before the call.","tags":["trips"],"links":["n-lisbon"]}]}`
	upstream, _ := fakeCompletions(t, []string{suggestJSON})

	body := `{"persona":"Nova","context":[],"calendar":[{"title":"Lisbon planning call","start":"2026-06-12T15:00:00Z","end":"2026-06-12T16:00:00Z"}]}`
	status, respBody := postSuggest(t, upstream.URL, body)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, respBody)
	}
	var out struct{ Suggestions []Note }
	if err := json.Unmarshal([]byte(respBody), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Suggestions) != 1 {
		t.Fatalf("suggestions = %#v", out.Suggestions)
	}
}
