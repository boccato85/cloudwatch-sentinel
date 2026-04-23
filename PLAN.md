# Plano Step By Step: Correcoes Pos-Code Review para v1.0.0-rc.2

## Summary

Objetivo: transformar o estado atual `v1.0-rc1` em um RC mais consistente para release, corrigindo drift entre docs/codigo, endurecendo Helm e removendo contrato publico de LLM local.

Decisoes fechadas:
- LLM sera provider-agnostic e sem LLM local/Ollama como contrato publico.
- Helm deve exigir `database.password` explicitamente, como ja faz com `agent.auth.token`.
- Rate limit deve usar apenas `RemoteAddr` nesta rodada, ignorando `X-Real-IP`.
- O arquivo de plano alvo e `PLAN.md`.

## Implementation Changes

1. Preparacao
- Preservar o workspace atual: `.gitignore` e `docs/screenshots/sentinel_ss_0.10.20(5).png` ja estavam staged antes desta implementacao.
- Antes de editar, conferir `git status --short` e trabalhar apenas nos arquivos necessarios.

2. Docs/runtime contract
- Corrigir referencias de setup que apontam para `agent/.env.example`; a fonte real e `.env.example` na raiz.
- Remover ou corrigir referencias a `make start`, `make stop` e `make logs`; o `agent/Makefile` so suporta `build`, `setup`, `clean` e `help`.
- Atualizar docs para separar claramente `v1.0.0-rc.2` implementado de M8 planejado.
- Remover das docs de configuracao qualquer afirmacao de que `SENTINEL_LLM_*`, `LLM_PROVIDER`, `OLLAMA_*`, Gemini/OpenAI ou Ollama ativam funcionalidade hoje.
- Manter M8 como backlog provider-agnostic: cloud LLM futuro, contrato final ainda TBD, sem LLM local.

3. LLM package alignment
- Ajustar `agent/pkg/llm` para nao expor Ollama como provider funcional.
- Manter apenas a interface/fachada minima para futuro M8, sempre disabled em `v1.0.0-rc.2`.
- Atualizar testes de `pkg/llm` para cobrir: default disabled, provider/env desconhecido nao ativa, nenhuma dependencia de `OLLAMA_ENDPOINT` ou `OLLAMA_MODEL`.

4. Helm hardening
- Atualizar `helm/sentinel/Chart.yaml` para versao/appVersion coerentes com `1.0.0-rc.2`.
- Atualizar `helm/sentinel/values.yaml`: imagem default para GHCR, tag coerente com RC, `pullPolicy: IfNotPresent`.
- Remover `database.password: sentinel123`; deixar vazio e exigir valor no template com `required`.
- Limpar ruido estrutural: remover `ons: []` e duplicidade de `affinity`.
- Adicionar `resources: {}` em `values.yaml` se o template do Deployment continuar usando `.Values.resources`.

5. Rate limit security
- Alterar `RateLimitMiddleware` para identificar cliente apenas por `RemoteAddr`.
- Remover confianca em `X-Real-IP` nesta rodada.
- Adicionar teste em `agent/pkg/api/api_test.go` provando que requests com `X-Real-IP` diferente, mas mesmo `RemoteAddr`, compartilham o mesmo bucket.
- Documentar em `SECURITY.md` que rate limit e por IP observado pelo agente.

## Public Interfaces

- Setup local usa `.env.example` na raiz, nao `agent/.env.example`.
- Comandos documentados refletem o Makefile real: `make build`, `make setup`, `make clean`, `make help`.
- Helm install exige explicitamente `--set agent.auth.token=<secret>` e `--set database.password=<secret>`.
- Nenhuma variavel LLM e documentada como funcional em `v1.0.0-rc.2`.
- `X-Real-IP` deixa de influenciar rate limit; `RemoteAddr` e a unica fonte.

## Test Plan

- `cd agent && go test ./...`
- `python3 harness/test_output_validator.py`
- `helm lint helm/sentinel --set agent.auth.token=test-token --set database.password=test-password`
- Teste negativo: `helm lint helm/sentinel` sem secrets deve falhar por `required`.
- Revisao textual com `rg` para drift de docs/runtime.

## Assumptions

- Nao implementar cloud LLM nesta rodada; isso permanece para M8.
- Nao adicionar trusted proxies agora; a solucao de v1.0.0-rc.2 e simples e segura: `RemoteAddr only`.
- Nao mexer no OpenAPI salvo se alguma API publica mudar.
- Nao alterar os arquivos staged preexistentes fora do necessario.
