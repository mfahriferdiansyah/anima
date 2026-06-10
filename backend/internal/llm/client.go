// Package llm provides the OpenRouter chat-completion client.
package llm

import (
	"context"
	"errors"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

// Message is a single chat message. The JSON tags match the wire format the
// frontend sends for transcript entries.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamChunk is one unit of a streamed completion: a content delta, the
// terminal Done marker, or a terminal error.
type StreamChunk struct {
	Delta string
	Done  bool
	Err   error
}

// Client is a concrete OpenRouter client (OpenAI-compatible API). It is
// deliberately NOT an interface: there is a single implementation by design;
// extract an interface only if a second real provider materializes.
type Client struct {
	api openai.Client
}

// New builds a Client against an OpenAI-compatible base URL (OpenRouter by
// default). The extra headers identify the app to OpenRouter's rankings.
func New(apiKey, baseURL string) *Client {
	return &Client{api: openai.NewClient(
		option.WithAPIKey(apiKey),
		option.WithBaseURL(baseURL),
		option.WithHeader("HTTP-Referer", "https://github.com/mfahriferdiansyah/anima"),
		option.WithHeader("X-OpenRouter-Title", "ANIMA"),
	)}
}

// StreamChat streams a chat completion. The returned channel yields content
// deltas in order, then exactly one terminal chunk (Done or Err), and is
// closed. Cancelling ctx aborts the upstream request.
func (c *Client) StreamChat(ctx context.Context, model string, msgs []Message) (<-chan StreamChunk, error) {
	if model == "" {
		return nil, errors.New("llm: model must not be empty")
	}
	stream := c.api.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
		Model:    model,
		Messages: toParams(msgs),
	})
	ch := make(chan StreamChunk)
	go func() {
		defer close(ch)
		defer stream.Close()
		for stream.Next() {
			chunk := stream.Current()
			if len(chunk.Choices) == 0 || chunk.Choices[0].Delta.Content == "" {
				continue
			}
			select {
			case ch <- StreamChunk{Delta: chunk.Choices[0].Delta.Content}:
			case <-ctx.Done():
				return
			}
		}
		terminal := StreamChunk{Done: true}
		if err := stream.Err(); err != nil {
			terminal = StreamChunk{Err: err}
		}
		select {
		case ch <- terminal:
		case <-ctx.Done():
		}
	}()
	return ch, nil
}

// Complete returns a full (non-streamed) completion. Used by the distiller,
// which needs the whole response before it can parse JSON out of it.
func (c *Client) Complete(ctx context.Context, model string, msgs []Message) (string, error) {
	if model == "" {
		return "", errors.New("llm: model must not be empty")
	}
	resp, err := c.api.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model:    model,
		Messages: toParams(msgs),
	})
	if err != nil {
		return "", err
	}
	if len(resp.Choices) == 0 {
		return "", errors.New("llm: completion returned no choices")
	}
	return resp.Choices[0].Message.Content, nil
}

func toParams(msgs []Message) []openai.ChatCompletionMessageParamUnion {
	params := make([]openai.ChatCompletionMessageParamUnion, 0, len(msgs))
	for _, m := range msgs {
		switch m.Role {
		case "system":
			params = append(params, openai.SystemMessage(m.Content))
		case "assistant":
			params = append(params, openai.AssistantMessage(m.Content))
		default:
			params = append(params, openai.UserMessage(m.Content))
		}
	}
	return params
}
