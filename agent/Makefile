BINARY   := sentinel-agent
ENV_FILE := ../.env
ENV_EXAMPLE := ../.env.example

.PHONY: build setup clean help

build:
	go build -o $(BINARY) .

setup:
	@if [ ! -f $(ENV_FILE) ]; then \
		cp $(ENV_EXAMPLE) $(ENV_FILE); \
		echo "✅ .env created from .env.example"; \
	else \
		echo "ℹ️  .env already exists — skipping"; \
	fi

clean:
	rm -f $(BINARY)

help:
	@echo "Sentinel Agent Makefile"
	@echo "-----------------------"
	@echo "build : Compiles the Go binary locally"
	@echo "clean : Removes the compiled binary"
	@echo ""
	@echo "NOTE: Host services (systemd) were removed for safety."
	@echo "To run Sentinel, use Helm or Podman/Minikube as per GEMINI.md"

# Os comandos start/stop/status foram removidos para proteger a integridade do host.
# O Sentinel agora deve ser operado via Kubernetes (Minikube).
