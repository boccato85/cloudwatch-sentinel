package llm

import "testing"

func TestNewClient_NoProvider(t *testing.T) {
	c := NewClient()
	if c.Enabled {
		t.Error("expected Enabled=false in v1.0-rc2")
	}
	if c.ActiveProvider != nil {
		t.Error("expected ActiveProvider=nil in v1.0-rc2")
	}
}

func TestNewClient_IgnoresProviderEnv(t *testing.T) {
	t.Setenv("FUTURE_LLM_PROVIDER", "cloud")
	c := NewClient()
	if c.Enabled {
		t.Error("expected Enabled=false when provider env vars are set")
	}
	if c.ActiveProvider != nil {
		t.Error("expected ActiveProvider=nil when provider env vars are set")
	}
}

func TestNewClient_IgnoresLocalLLMEnv(t *testing.T) {
	t.Setenv("LOCAL_LLM_ENDPOINT", "http://localhost:11434")
	t.Setenv("LOCAL_LLM_MODEL", "local")
	c := NewClient()
	if c.Enabled {
		t.Error("expected Enabled=false when local LLM env vars are set")
	}
	if c.ActiveProvider != nil {
		t.Error("expected ActiveProvider=nil when local LLM env vars are set")
	}
}
