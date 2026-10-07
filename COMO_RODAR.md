# Como rodar o bot (WHV Nova Zelândia)

## ⚡ HOJE (07/10) — modo co-piloto

Teste Peru (30/09) mostrou: **captcha antes do formulário** e **painel sem botão de aplicar previsível**.
O `live` automático NÃO é confiável. Use o `assist`:

1. **16:30** — `npm run open` (terminal 1). Loga no INZ nesse Chrome.
2. **16:45** — `npm run assist` (terminal 2). Deixa rodando.
3. **17:00** — **você** atualiza o painel e entra na aplicação (Edit no rascunho ou nova).
4. **Captcha → você resolve.** O bot espera e não clica em nada nele.
5. **Bot preenche cada tela na hora e avança sozinho** (~200ms por tela).
   Se aparecer `CAMPOS SEM RESPOSTA` ou `ERRO DE VALIDACAO` no terminal → completa você e clica Next; ele segue na próxima.
6. **Declaração → você** revisa, marca e clica **Submit**. O bot nunca faz isso.
7. **Pagamento → bot preenche o cartão + alarme.** Você confere, paga, faz o OTP.

Testado ponta-a-ponta em portal simulado: `npm run assist-test` (18/18).

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
