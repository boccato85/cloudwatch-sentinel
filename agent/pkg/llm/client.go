package llm

import (
	"context"
	"log/slog"
	"os"
)

// Provider defines the interface for LLM integrations
type Provider interface {
	GenerateEnrichment(ctx context.Context, incidentJSON string) (narrative string, runbook string, err error)
}

// Client manages the active LLM provider for the Sentinel Agent
type Client struct {
	ActiveProvider Provider
	Enabled        bool
}

// NewClient initializes the LLM client based on environment variables
func NewClient() *Client {
	providerName := os.Getenv("LLM_PROVIDER")
	if providerName == "" {
		return &Client{Enabled: false}
	}

	slog.Info("LLM provider configured", "provider", providerName)

	var p Provider
	switch providerName {
	case "ollama":
		p = newOllamaProvider()
	case "gemini":
		// p = newGeminiProvider() // Future implementation
	default:
		slog.Warn("Unknown LLM provider, falling back to deterministic mode", "provider", providerName)
		return &Client{Enabled: false}
	}

	return &Client{
		ActiveProvider: p,
		Enabled:        true,
	}
}

// --- Ollama Implementation Skeleton ---

type ollamaProvider struct {
	Endpoint string
	Model    string
}

func newOllamaProvider() *ollamaProvider {
	endpoint := os.Getenv("OLLAMA_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://ollama.default.svc.cluster.local:11434"
	}
	model := os.Getenv("OLLAMA_MODEL")
	if model == "" {
		model = "llama3"
	}
	return &ollamaProvider{
		Endpoint: endpoint,
		Model:    model,
	}
}

func (o *ollamaProvider) GenerateEnrichment(ctx context.Context, incidentJSON string) (string, string, error) {
	// TODO: Implement HTTP POST to Ollama API with tight timeout
	// Example logic:
	// 1. Create JSON payload for Ollama with the incident data
	// 2. http.NewRequestWithContext(ctx, "POST", o.Endpoint+"/api/generate", body)
	// 3. Parse response and extract narrative + runbook
	// 4. Return
	return "", "", nil
}
