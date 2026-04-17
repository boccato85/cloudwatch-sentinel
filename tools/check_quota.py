#!/usr/bin/env python3
import json
import os
import time
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

# ANSI Colors
RED = "\033[0;31m"
YELLOW = "\033[0;33m"
GREEN = "\033[0;32m"
CYAN = "\033[0;36m"
DIM = "\033[0;90m"
RESET = "\033[0m"

GEMINI_DIR = Path.home() / ".gemini"
OAUTH_FILE = GEMINI_DIR / "oauth_creds.json"
CODE_ASSIST_BASE_URL = "https://cloudcode-pa.googleapis.com/v1internal"
TOKEN_URL = "https://oauth2.googleapis.com/token"

def read_json(path):
    try:
        return json.loads(path.read_text())
    except:
        return None

def get_creds():
    return read_json(OAUTH_FILE)

def refresh_token(creds):
    """Tenta dar refresh no token usando as credenciais do Gemini CLI."""
    # Tenta obter client_id/secret das credenciais ou env
    client_id = creds.get("client_id")
    client_secret = creds.get("client_secret")
    refresh_token = creds.get("refresh_token")

    if not all([client_id, client_secret, refresh_token]):
        # Se não tem no JSON, tentamos um fallback comum para o Gemini CLI
        # Nota: Em um script real, poderíamos extrair do oauth2.js como o original faz,
        # mas vamos assumir que o usuário rodou 'gemini' recentemente.
        raise RuntimeError("Credenciais incompletas em ~/.gemini/oauth_creds.json. Rode 'gemini' primeiro.")

    payload = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode()

    req = urllib.request.Request(
        TOKEN_URL,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read())
        creds.update({
            "access_token": result["access_token"],
            "expiry_date": int(time.time() * 1000 + int(result.get("expires_in", 3600)) * 1000)
        })
        OAUTH_FILE.write_text(json.dumps(creds, indent=2))
        return creds["access_token"]

def get_access_token():
    creds = get_creds()
    if not creds:
        raise RuntimeError(f"Arquivo {OAUTH_FILE} não encontrado. Faça login no Gemini CLI.")

    expiry = int(creds.get("expiry_date", 0))
    if time.time() * 1000 >= expiry - 60000:
        return refresh_token(creds)
    
    return creds["access_token"]

def call_api(method, payload, token):
    req = urllib.request.Request(
        f"{CODE_ASSIST_BASE_URL}:{method}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())

def main():
    print(f"{CYAN}╔══ Sentinel Quota Monitor (Google One Pro) ══╗{RESET}")
    try:
        token = get_access_token()
        
        # 1. Obter projeto associado
        load_res = call_api("loadCodeAssist", {"metadata": {"pluginType": "GEMINI"}}, token)
        project_id = load_res.get("cloudaicompanionProject")
        
        if not project_id:
            print(f"{RED}[!] Nenhum projeto Code Assist encontrado.{RESET}")
            return

        # 2. Obter quotas
        quota_res = call_api("retrieveUserQuota", {"project": project_id}, token)
        buckets = quota_res.get("buckets", [])

        print(f"  Auth      : {GREEN}Google Login (OAuth2){RESET}")
        print(f"  Projeto   : {DIM}{project_id}{RESET}")
        print(f"  Tier      : {CYAN}{load_res.get('currentTier', {}).get('name', 'N/A')}{RESET}")
        print(f"  Atualizado: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
        print(f"╚══════════════════════════════════════════════╝\n")

        for b in buckets:
            model = b.get("modelId", "unknown").split("/")[-1]
            rem_frac = b.get("remainingFraction", 1.0)
            used_pct = (1 - rem_frac) * 100
            
            color = GREEN if used_pct < 70 else YELLOW if used_pct < 90 else RED
            bar_len = 20
            filled = int((used_pct / 100) * bar_len)
            bar = f"{color}{'█' * filled}{DIM}{'░' * (bar_len - filled)}{RESET}"
            
            print(f"  {model:25s} {used_pct:5.1f}% [{bar}]")

    except Exception as e:
        print(f"{RED}[!] Erro: {str(e)}{RESET}")
        print(f"{YELLOW}Dica: Tente rodar 'gemini' no terminal para atualizar o login.{RESET}")

if __name__ == "__main__":
    main()
