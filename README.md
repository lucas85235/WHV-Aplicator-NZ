# WHV Aplicator

Bot que aplica para o **Work and Holiday Visa 462** (ImmiAccount) no instante em que
as vagas abrem — mais rápido que um humano. Plano completo em [PLANO.md](PLANO.md).

## Stack
Node + TypeScript + Playwright. Controle do navegador por **attach CDP** ao Chrome
logado do usuário. Pagamento: bot preenche o cartão, usuário faz só o OTP.

## Setup
```bash
npm install
npx playwright install chromium   # opcional (no modo attach usamos o Chrome real)
cp config/secrets.example.json config/secrets.local.json   # e preencha o cartao
npm run typecheck
```

Preencha com seus dados **reais**:
- `config/applicant.json` — todos os campos das 14 páginas
- `config/documents.json` — caminhos dos 5 PDFs
- `config/secrets.local.json` — cartão (NUNCA commitado)

## Uso
```bash
npm run chrome      # como abrir o Chrome com debugging + login manual
npm run rehearsal   # ensaia ate o gate (nao submete) — use a vontade
npm run live        # dia D: hot-path ate o pagamento
npm run monitor     # vigia abertura de vagas
npm run codegen     # calibrar seletores na app real (playwright codegen)
```

## Estado (M0/M1 prontos)
Esqueleto + configs prontos. Lógica de preenchimento das páginas (M3), gate (M4),
documentos (M5) e pagamento (M6) ainda são stubs — preenchidos após a **calibração**
contra a aplicação salva real. Ver roadmap no PLANO.md.

## Avisos
- Dados do formulário devem ser **verdadeiros** (mentir = banimento até 10 anos).
- Automatizar o site pode conflitar com os ToS — risco assumido pelo usuário.
- `config/secrets.local.json` e `artifacts/` estão no `.gitignore`.
