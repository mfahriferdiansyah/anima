package chat

import "testing"

func TestStripFences(t *testing.T) {
	cases := map[string]string{
		"```json\n{\"a\":1}\n```": `{"a":1}`,
		"```\n{\"a\":1}\n```":     `{"a":1}`,
		`{"a":1}`:                 `{"a":1}`,
		"  {\"a\":1}  ":           `{"a":1}`,
	}
	for in, want := range cases {
		if got := stripFences(in); got != want {
			t.Errorf("stripFences(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateNotes_DropsTitlelessAndCoalesces(t *testing.T) {
	in := []Note{
		{Title: "keep", Body: "b"},          // nil tags/links → coalesced
		{Title: "   ", Body: "no title"},    // dropped
		{Title: "", Body: "also no title"},  // dropped
		{Title: "two", Body: "b", Tags: []string{"x"}, Links: []string{"n1"}},
	}
	out := validateNotes(in)
	if len(out) != 2 {
		t.Fatalf("got %d notes, want 2: %#v", len(out), out)
	}
	if out[0].Title != "keep" || out[1].Title != "two" {
		t.Fatalf("unexpected notes: %#v", out)
	}
	if out[0].Tags == nil || out[0].Links == nil {
		t.Fatalf("nil slices were not coalesced: %#v", out[0])
	}
}

func TestParseDraft_Prepared(t *testing.T) {
	raw := "```json\n{\"prepared\":true,\"title\":\"Demo day prep\",\"body\":\"## Agenda\\n- one\",\"tags\":[\"work\"]}\n```"
	d, ok := parseDraft(raw)
	if !ok {
		t.Fatal("parseDraft returned ok=false for a valid draft")
	}
	if !d.Prepared || d.Title != "Demo day prep" || d.Body == "" {
		t.Fatalf("draft = %#v", d)
	}
	if d.Tags == nil || d.Links == nil {
		t.Fatalf("nil slices not coalesced: %#v", d)
	}
}

func TestParseDraft_NotPreparedKeepsReasonNoBody(t *testing.T) {
	d, ok := parseDraft(`{"prepared":false,"reason":"nothing on the calendar yet"}`)
	if !ok {
		t.Fatal("parseDraft returned ok=false")
	}
	if d.Prepared {
		t.Fatalf("want prepared=false, got %#v", d)
	}
	if d.Body != "" {
		t.Fatalf("not-prepared draft must have no body, got %q", d.Body)
	}
	if d.Reason == "" {
		t.Fatalf("reason should be preserved")
	}
}

// A model that claims prepared:true but leaves the body empty is demoted to
// not-prepared so the client never seals an empty note (R12).
func TestParseDraft_DemotesEmptyBodyToNotPrepared(t *testing.T) {
	d, ok := parseDraft(`{"prepared":true,"title":"Draft","body":"   "}`)
	if !ok {
		t.Fatal("parseDraft returned ok=false")
	}
	if d.Prepared {
		t.Fatalf("empty-body draft should be demoted to prepared=false, got %#v", d)
	}
	if d.Reason == "" {
		t.Fatalf("demoted draft should carry a reason")
	}
}

func TestParseDraft_MalformedReturnsNotOk(t *testing.T) {
	if _, ok := parseDraft("sorry, not JSON at all"); ok {
		t.Fatal("parseDraft should return ok=false for unparseable input")
	}
}
