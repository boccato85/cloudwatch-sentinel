package llm

import "testing"

func TestNewClient_NoProvider(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "")
	c := NewClient()
	if c.Enabled {
		t.Error("expected Enabled=false when LLM_PROVIDER is not set")
	}
	if c.ActiveProvider != nil {
		t.Error("expected ActiveProvider=nil when LLM_PROVIDER is not set")
	}
}

func TestNewClient_UnknownProvider(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "openai")
	c := NewClient()
	if c.Enabled {
		t.Error("expected Enabled=false for unknown provider")
	}
	if c.ActiveProvider != nil {
		t.Error("expected ActiveProvider=nil for unknown provider")
	}
}

func TestNewClient_GeminiNotImplemented(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "gemini")
	c := NewClient()
	if c.Enabled {
		t.Error("expected Enabled=false for gemini (not yet implemented)")
	}
	if c.ActiveProvider != nil {
		t.Error("expected ActiveProvider=nil for gemini (not yet implemented)")
	}
}

func TestNewClient_OllamaProvider(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "ollama")
	t.Setenv("OLLAMA_ENDPOINT", "http://localhost:11434")
	t.Setenv("OLLAMA_MODEL", "llama3")
	c := NewClient()
	if !c.Enabled {
		t.Error("expected Enabled=true for ollama provider")
	}
	if c.ActiveProvider == nil {
		t.Error("expected ActiveProvider!=nil for ollama provider")
	}
}
