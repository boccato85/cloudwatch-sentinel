# Análise Comparativa — CloudWatch Sentinel
## Gemini Edition vs Claude Code Edition

**Data da análise:** 2026-04-05  
**Contexto:** A Claude Code Edition foi adaptada da Gemini Edition. Durante a adaptação e revisão cruzada dos dois repositórios, foram identificados problemas críticos, médios e melhorias arquiteturais. Este documento lista tudo que foi corrigido na Claude Code Edition e serve como referência para aplicar os mesmos ajustes na Gemini Edition.

---

## 🔴 Problemas Críticos

### C1 — Harness bypass: `report_tool.py` e `benchmark.py` gravam direto em disco

**Arquivo afetado:** `.gemini/tools/report_tool.py`, `.gemini/tools/benchmark.py`

**Problema:**  
O `validador_saida.py` existe e funciona, mas **nunca é chamado** pelos scripts Python. Tanto o `report_tool.py` quanto o `benchmark.py` usam `open(filename, "w")` diretamente, sem passar pelo harness. O validador só é acionado quando o agente usa a ferramenta especial `salvar_relatorio_seguro` definida no `settings.json` — ou seja, o gatekeeper é facilmente contornado, até mesmo por acidente.

**Evidência:**  
O arquivo `reports/2026-03-31_14-16_OK.md` gerado pelo `benchmark.py` em execução real contém apenas 3 linhas e **não possui a seção `## Resumo Executivo`** — o que significa que se passasse pelo validador, seria bloqueado. O benchmark gravou sem validar.

**Impacto:**  
Qualquer relatório gerado autonomamente pelo agente pode conter comandos destrutivos ou carecer de estrutura mínima sem ser detectado.

**Correção aplicada na Claude Code Edition:**  
`tools/report_tool.py` agora chama `harness/validador_saida.py` via `subprocess` antes de qualquer `open()`. Se o validador retornar `exit(1)`, a gravação é abortada e o erro é reportado em stdout como JSON.

```python
result = subprocess.run(
    [sys.executable, HARNESS],
    input=content,
    capture_output=True,
    text=True,
)
if result.returncode != 0:
    return {"status": "error", "message": result.stderr.strip(), "file": None}
```

---

### C2 — `sanitize_environment` executa `kubectl delete events --all -A` (destrutivo)

**Arquivo afetado:** `.gemini/config.yaml` (tool `sanitize_environment`)

**Problema:**  
O comando de sanitização inclui `kubectl delete events --all -A`, que **apaga permanentemente todos os eventos de todos os namespaces** do cluster. Esses eventos são exatamente os dados que o agente usa para:
- Detectar erros de warm-up (`FailedMount`, `NetworkNotReady`)
- Identificar causa raiz de `CrashLoopBackOff`
- Distinguir eventos transitórios de problemas persistentes

Executar isso como etapa de "limpeza" antes de cada ciclo destrói a evidência que o próprio agente precisa analisar.

**Impacto:**  
Falsos negativos: o agente pode concluir "cluster saudável" logo após apagar evidências de falhas reais. Perda irreversível de histórico operacional.

**Correção aplicada na Claude Code Edition:**  
`sanitize_environment` foi reduzido a apenas `rm -f *.json`. Eventos K8s nunca são apagados automaticamente.

---

### C3 — Thresholds duplicados e potencialmente divergentes

**Arquivos afetados:** `GEMINI.md` e `.gemini/tools/benchmark.py`

**Problema:**  
Os thresholds estão definidos em dois lugares com lógicas independentes:

1. Em `GEMINI.md` — para o LLM raciocinar (contexto de prompt)
2. Hardcoded em `benchmark.py` — para o ciclo autônomo Python

```python
# benchmark.py — hardcoded
if cpu > 85 or mem > 90:
    severity = "CRITICAL"
elif cpu > 70 or mem > 75:
    severity = "WARNING"
```

Se alguém ajustar o threshold de CPU WARNING de 70% para 65% no `GEMINI.md`, o `benchmark.py` continuará usando 70% silenciosamente. O agente e o benchmark passam a ter comportamentos divergentes sem nenhum aviso.

**Impacto:**  
O benchmark pode reportar `OK` enquanto o agente reportaria `WARNING` para os mesmos dados — ou vice-versa. Inconsistência silenciosa em produção.

**Correção aplicada na Claude Code Edition:**  
Criado `config/thresholds.yaml` como source of truth único. Tanto `tools/monitor.py` quanto `tools/benchmark.py` leem desse arquivo em runtime:

```yaml
cpu:
  warning: 70
  critical: 85
memory:
  warning: 75
  critical: 90
disk:
  warning: 70
  critical: 85
```

---

### C4 — Path hardcoded no `settings.json`

**Arquivo afetado:** `.gemini/settings.json`

**Problema:**  
A ferramenta `salvar_relatorio_seguro` usa o caminho absoluto da máquina do desenvolvedor:

```json
"command": "bash",
"args": ["-c", "echo \"$1\" | python3 /home/boccatosantos/src/estudos/AI/cloudwatch-sentinel-gemini/harness/validador_saida.py > /home/boccatosantos/.../relatorio_final.md"]
```

Qualquer pessoa que clonar o repositório em outra máquina terá a ferramenta quebrada silenciosamente — o `echo` executa mas o Python não encontra o arquivo.

**Impacto:**  
Portabilidade zero. O harness falha sem erro visível para quem não conhece o projeto.

**Correção recomendada:**  
Usar caminhos relativos ao diretório do projeto ou uma variável de ambiente:

```json
"args": ["-c", "echo \"$1\" | python3 harness/validador_saida.py > reports/relatorio_final.md"]
```

---

## 🟡 Problemas Médios

### M1 — `validador_saida.py` com lista de padrões proibidos insuficiente

**Arquivo afetado:** `harness/validador_saida.py`

**Problema:**  
O validador bloqueia apenas `rm -rf` e `kubectl delete`. Comandos igualmente destrutivos passam sem restrição:

| Comando | Risco |
|---|---|
| `DROP TABLE` / `DROP DATABASE` | Apaga dados de banco |
| `TRUNCATE TABLE` | Apaga todos os registros |
| `dd if=` | Sobrescreve dispositivos de bloco |
| `mkfs` | Formata partições |
| `> /dev/sda` | Destrói disco via redirecionamento |
| `:(){:\|:&};:` | Fork bomb — derruba o sistema |

**Correção aplicada na Claude Code Edition:**

```python
FORBIDDEN_PATTERNS = [
    "rm -rf",
    "kubectl delete",
    "DROP TABLE",
    "DROP DATABASE",
    "TRUNCATE TABLE",
    "dd if=",
    "mkfs",
    "> /dev/",
    "format c:",
    ":(){:|:&};:",
]
```

---

### M2 — `validador_saida.py` sem verificação de tamanho mínimo

**Arquivo afetado:** `harness/validador_saida.py`

**Problema:**  
Um relatório de 1 linha contendo apenas `## Resumo Executivo` passaria pela validação sem problemas — o validador não verifica se o conteúdo é minimamente substantivo.

**Correção aplicada na Claude Code Edition:**  
Verificação de tamanho mínimo de 100 caracteres adicionada antes das demais validações.

---

### M3 — Nome de arquivo inconsistente no `config.yaml`

**Arquivo afetado:** `.gemini/config.yaml`

**Problema:**  
```yaml
- name: "monitor_cluster"
  command: "python3 .gemini/tools/monitor_tool.py"  # ← não existe
```

O arquivo no repositório se chama `monitor.py`, não `monitor_tool.py`. A ferramenta está quebrada na definição mas funciona apenas porque o Gemini pode invocar o script por outros meios.

**Correção recomendada:**  
Corrigir para `python3 .gemini/tools/monitor.py`.

---

### M4 — Port-forwards órfãos não são limpos antes de criar novos

**Arquivo afetado:** Lógica de startup (equivalente ao `/startup` na Claude Edition)

**Problema:**  
Se o agente foi encerrado abruptamente em uma sessão anterior, os processos `kubectl port-forward` podem continuar rodando em background ocupando as portas 9090, 3000 e 9093. Na próxima execução, o health check retorna `200` (serviço parece UP) mas o processo subjacente pode estar em estado inconsistente, ou a porta pode estar ocupada impedindo um novo port-forward de subir.

**Correção aplicada na Claude Code Edition:**  
Antes de criar novos port-forwards, o startup verifica por porta se há processo ocupando-a. Se o processo existe **e** o serviço não respondeu no health check, o processo é encerrado antes de criar o novo:

```bash
for PORT in 9090 3000 9093; do
  PID=$(lsof -ti tcp:$PORT 2>/dev/null)
  if [ -n "$PID" ]; then
    kill $PID 2>/dev/null && echo "Órfão encerrado na porta $PORT (PID $PID)"
  fi
done
```

---

### M5 — Ausência de `.gitignore`

**Problema:**  
Nenhuma das duas edições tem `.gitignore`. Os arquivos `.json` temporários gerados pelo `monitor.py` (output do cluster) e eventuais `.env`, `__pycache__/` e logs podem ser commitados acidentalmente — incluindo dados de configuração do cluster local.

**Correção aplicada na Claude Code Edition:**

```gitignore
*.json
__pycache__/
*.pyc
*.pyo
.env
.env.*
*.log
/tmp/
```

---

## 🟢 Melhorias Arquiteturais Implementadas

### A1 — Verificação automática do Minikube antes do startup

**Contexto:**  
A versão Gemini pressupõe que o cluster já está rodando. Se o Minikube estiver `Stopped`, os port-forwards falham silenciosamente com `i/o timeout` e o agente encerra sem diagnóstico claro.

**Melhoria na Claude Code Edition:**  
O `/startup` agora tem uma **Fase 0** que verifica `minikube status` antes de qualquer ação. Se `Stopped`, executa `minikube start` e aguarda `kubectl get nodes` retornar `Ready` com retry (20 tentativas, intervalo 15s, ~5 minutos de tolerância). Só então prossegue para os health checks dos serviços.

---

### A2 — Encoding UTF-8 explícito no validador

**Contexto:**  
O validador original usa `sys.stdin.read()` sem especificar encoding. Em ambientes com `LANG=C` ou terminais não-UTF-8, relatórios com caracteres especiais (acentos, símbolos ║ dos boxes ASCII) podem causar `UnicodeDecodeError` silencioso.

**Melhoria:**  
Leitura com tratamento explícito de `UnicodeDecodeError`, encerrando com mensagem de erro clara ao invés de traceback Python.

---

### A3 — `report_tool.py` retorna JSON estruturado de erro

**Contexto:**  
O `report_tool.py` original retorna `{"status": "error", ...}` mas não encerra com `sys.exit(1)`. O agente pode interpretar o JSON de erro como sucesso se não checar o campo `status`.

**Melhoria:**  
`report_tool.py` encerra com `sys.exit(1)` quando o validador bloqueia, garantindo que qualquer script ou agente que chame o tool receba um exit code não-zero detectável.

---

## Resumo das Correções por Arquivo

| Arquivo | Tipo | Correção |
|---|---|---|
| `harness/validador_saida.py` | 🔴 C1 + 🟡 M1 + M2 | Criado/expandido: harness real, 10 padrões proibidos, tamanho mínimo, UTF-8 |
| `tools/report_tool.py` | 🔴 C1 | Gravação obrigatoriamente via harness |
| `tools/benchmark.py` | 🔴 C1 + C3 | Harness respeitado; thresholds lidos do YAML |
| `config/thresholds.yaml` | 🔴 C3 | Criado como source of truth único |
| `tools/monitor.py` | 🔴 C3 | Lê thresholds do YAML |
| `.gemini/config.yaml` | 🟡 M3 | Nome do script corrigido (`monitor_tool.py` → `monitor.py`) |
| `settings.json` | 🔴 C4 | Paths absolutos → relativos |
| startup | 🔴 C2 + 🟡 M4 | Removido `kubectl delete events`; limpeza de órfãos por porta |
| `.gitignore` | 🟡 M5 | Criado |

---

## Observação Final

A maioria dos problemas críticos compartilha a mesma raiz: **o harness foi projetado corretamente mas não é enforced no código Python**. É um gatekeeper opcional em vez de obrigatório. A correção central é garantir que nenhum arquivo seja gravado em disco sem passar pelo `validador_saida.py` — independente de qual caminho de execução foi tomado (agente, benchmark, tool direta).
