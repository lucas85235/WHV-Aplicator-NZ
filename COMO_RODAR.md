# Como rodar o bot (WHV Nova Zelândia)

## ⚡ HOJE (07/10) — co-piloto com entrada automática

1. **Agora:** no Chrome do bot, vá em *Working Holiday Schemes* → **BRAZIL** (página "There is no scheme open").
2. **Agora:** `Ctrl+C` em qualquer assist antigo → `npm run assist`. Deixa rodando.
   - até 16:58 ele só atualiza a página a cada ~4 min (mantém a sessão viva)
   - 16:58:00–16:59:40 a cada ~2,5s · **16:59:40–17:02 a cada ~1,2s**
   - quando aparecer *Scheme is available* **na página do Brasil** → clica APPLY NOW + alarme + push
3. **Captcha → você.** O alarme para sozinho quando você passa dele.
4. **Bot preenche cada tela e aperta Next.** Se você **clicar, rolar ou digitar** numa tela, ela vira sua: o bot não escreve nem avança nela. Você clica Next, ele volta a ajudar na próxima.
5. **Confira:** sobrenome = passaporte · TB 5 anos = **Yes** · requisitos do esquema = **Yes** · saúde/caráter verdadeiros. A pergunta *"If you are a passport holder of a country NOT considered low risk for TB…"* é sua.
6. **Declaração + Submit → você.** Pagamento: bot preenche o cartão, você confere, paga e faz o OTP.

Nunca clica Apply Now de outro país. Nunca marca declaração, nunca submete, nunca paga.
Ensaio completo simulado: `npm run diad-test` (20/20).

---

**Dia D: 07/10/2026, 17:00 em Manaus** (= 08/10 10:00 na Nova Zelândia).
Confira com `npm run when`.

## Antes (fazer semanas antes)
- **Criar a conta** no portal WHS do INZ e verificar o e-mail. Sem conta pronta, não tem corrida.
- Gravar o login com `npm run secrets` — pergunta usuário e senha no terminal (senha
  mascarada) e grava em `config/secrets.local.json`, que está no `.gitignore`.
  Nunca cole a senha em chat, issue ou commit.
- Conferir o cartão em `config/secrets.local.json` (veio do projeto australiano;
  o mesmo cartão serve, a cobrança é em NZD).
- Contratar o **seguro médico** e conferir os **NZD 4.200** no extrato.
- Avisar o banco que vai ter compra internacional de ~NZD 770.
- **Desligar suspensão do Windows**: Configurações → Sistema → Energia → tela e suspensão = **Nunca**.
- Notebook na tomada, tampa aberta.

## Rodar (2 terminais)

**Terminal 1 — Chrome do bot:**
```
npm run open
```
Abre um Chrome dedicado (porta 9222) na tela de login do INZ. **Faça login nele** e deixe a janela quieta.

**Terminal 2 — o bot:**
```
npm run live
```
Ele espera a cota abrir (poll conservador), entra na aplicação, preenche o formulário,
dispara o **alarme** + **push no celular**, e **para no pagamento**.

Para deixar rodando a madrugada inteira com reinício automático:
```
npm run watchdog
```

## Quando a cota abrir (alarme tocando)
1. Vai pro PC.
2. Confira o que o bot preencheu — role as telas, ele loga tudo no terminal.
3. No checkout: **confira o cartão**, clique em pagar, faça o **OTP do banco** (manual).
4. Volte no terminal e aperte **ENTER**.

Se o bot travar antes do pagamento, ele avisa (`ASSUMA A TELA`) e espera você terminar à mão.

## Testar sem esperar a abertura
```
npm run secrets     # grava usuário/senha do INZ (senha oculta, fica só local)
npm run login       # testa o login
npm run rehearsal   # loga, checa o estado da cota, varre a tela
npm run scan        # dumpa os campos da tela atual -> artifacts/scan-*.json
npm run notify-test # testa o push no celular
```

## Push no celular (recomendado)

### Opção A — ntfy (mais fácil, sem cadastro)
1. Instala o app **ntfy** no celular.
2. "Subscribe to topic" → um nome secreto (ex: `whv-nz-lucas-x7k2b`).
3. Em `config/secrets.local.json`:
```json
"notify": { "ntfyTopic": "whv-nz-lucas-x7k2b" }
```

### Opção B — Telegram
1. `@BotFather` → `/newbot` → guarda o token.
2. Manda msg pro teu bot, pega o chat id com `@userinfobot`.
3. Em `secrets.local.json`:
```json
"notify": { "telegram": { "botToken": "SEU_TOKEN", "chatId": "SEU_CHAT_ID" } }
```

## Status ao vivo
- `artifacts/status.json` — estado atual (`watch-idle` / `watch-hot` / `OPEN` / `walking` / `PAYMENT`).
- `artifacts/scan-*.json` — campos de cada tela + qual regra respondeu.
- `artifacts/s*.png` — screenshot de cada tela percorrida.

## Cuidados
- **Não feche** a janela do Chrome do bot enquanto roda.
- O bot **nunca paga sozinho**.
- Se ele responder algo errado numa tela, corrija na hora **e depois** ajuste o `config/answers.json`.
