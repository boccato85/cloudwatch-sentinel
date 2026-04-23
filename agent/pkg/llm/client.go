package llm

import (
	"context"
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
	return &Client{Enabled: false}
}
