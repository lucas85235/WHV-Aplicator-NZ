# Plano — WHV Nova Zelândia (esquema Brasil)

## 1. O alvo

| Item | Valor |
|---|---|
| Vagas | **300 por ano** |
| Abertura | **08 Out 2026, 10:00 NZDT** = `2026-10-07T21:00:00Z` = **17:00 de 07/10 em Manaus** |
| Duração em 2025 | vagas esgotaram em **< 8 minutos** |
| Idade | 18 a 30 anos (você faz 26 em 2026 ✔) |
| Fundos | **NZD 4.200** (~R$ 14 mil) comprovados |
| Seguro | médico + hospitalar cobrindo **toda** a estadia — condição do visto, **não** exigido na submissão |
| Passaporte | válido por 3+ meses após o fim do visto (o seu vence 28/02/2034 ✔) |
| Taxa | **a partir de NZD 770** (~R$ 2.500), Visa/Mastercard |
| Onde | https://onlineservices.immigration.govt.nz/secure/Login+Working+Holiday.htm |
| Info oficial | https://www.immigration.govt.nz/visas/brazil-working-holiday-visa/ |

Fontes: [INZ — Brazil Working Holiday Visa](https://www.immigration.govt.nz/visas/brazil-working-holiday-visa/),
[MFAT — Brazil-NZ working holidays](https://www.mfat.govt.nz/en/countries-and-regions/americas/brazil/new-zealand-embassy-to-brazil/brazil-new-zealand-working-holidays).

> **Confirmar o horário na página oficial em setembro.** Se mudar, editar
> `runtime.opening.isoUtc` em `config/runtime.json` e conferir com `npm run when`.

## 2. Por que a estratégia é diferente da Austrália

No 462 dava para deixar a aplicação **salva e completa** e correr só o último trecho.
Aqui **não existe aplicação pré-salva**: o botão "apply" só aparece quando a cota abre.
Ou seja:

```
[logado e esperando] → [cota abre] → [entrar na aplicação]
   → [Personal / Health / Character / WHS Specific] → [declarações]
   → [submit] → [pagamento com cartão] → vaga garantida
```

A corrida termina no **pagamento aprovado**. Tudo antes disso precisa ser rápido —
e o bot só ganha do humano se o *livro de respostas* estiver calibrado.

## 3. Arquitetura

- `src/form/scan.ts` — varre o DOM e devolve todo campo visível com a pergunta associada.
- `src/form/answer.ts` — casa campo × regra do `config/answers.json` e aplica o valor.
- `src/form/walk.ts` — loop de telas: varre → responde → avança → detecta pagamento/erro.
- `src/nz/login.ts` — login no portal WHS (usuário/senha, TOTP se existir).
- `src/nz/gate.ts` — espera a cota abrir (poll conservador + jitter) e entra na aplicação.
- `src/payment.ts` — preenche o cartão no checkout e **para**.
- `src/alarm.ts` / `src/notify.ts` — alarme sonoro no PC + push no celular (ntfy/Telegram).

Nada depende de seletor fixo do INZ, porque não dá pra ver o formulário antes.

## 4. Checklist de preparação (fazer ANTES de 07/10)

- [ ] **Criar a conta** no portal WHS agora (não dá pra criar no dia — e-mail precisa ser verificado).
- [ ] Guardar usuário/senha em `config/secrets.local.json` e testar com `npm run login`.
- [ ] **Seguro médico**: escolher provedor e guardar cotação. *Não* precisa comprar antes da abertura —
      o INZ lista o seguro em "After you apply" e pode checar na chegada. Comprar quando pedirem ou antes de embarcar.
- [ ] **Fundos**: extrato em inglês mostrando ≥ NZD 4.200 (Wise serve). Conferir o saldo.
- [ ] **Cartão** Visa/Mastercard com limite ≥ NZD 770 liberado para compra internacional
      (avisar o banco na véspera — bloqueio antifraude é o jeito mais burro de perder a vaga).
- [ ] Cartão reserva de outra bandeira em `secrets.backupCard`.
- [ ] Antecedentes criminais (PF) — o INZ pede se achar necessário; validade de 6 meses.
- [ ] Pesquisar médico credenciado (eMedical) em Manaus para o raio-X de tórax
      (Brasil é país de risco de TB — quase certo que vão pedir depois da inscrição).
- [ ] `npm run notify-test` → push chegando no celular.
- [ ] Windows sem suspensão, notebook na tomada.

## 5. Calibração (o que decide o sucesso)

O formulário só aparece com a cota aberta, então a calibração é feita **em camadas**:

1. **Agora:** `npm run rehearsal` — valida login, leitura de tela e estado da cota.
2. **Agora:** `npm run scan` em cada tela acessível (login, painel, perfil da conta).
   Sai um `artifacts/scan-*.json` com a `chaveDeBusca` de cada campo e qual regra casou.
3. **No dia:** o `walk` loga toda tela e todo campo sem resposta. `onUnanswered: "pause"`
   em `runtime.json` faz o bot parar e esperar você resolver o campo à mão — mais lento,
   porém mais seguro. Decidir qual modo usar até 06/10.

## 6. Latência — o que foi otimizado

Medido no `npm run selftest` (formulário fake de 26 campos + 1 reveal):

| Item | Antes | Depois |
|---|---|---|
| Preencher uma tela | 630 ms (campo a campo) | **198 ms** (lote) — 3,2x |
| Esperas entre telas | 900 ms fixos | adaptativo (~30-120 ms típico) |
| Screenshot por tela | 289 ms (página inteira) | 50 ms (viewport) ou 0 (`off`) |
| Detectar a abertura | ~2 s em média | **< 1 s** (rajada de 0,9 s perto do horário) |

Como:

- **Escrita em lote** (`src/form/fastfill.ts`): um único `page.evaluate` escreve a tela
  inteira. Cada operação do Playwright custa um round-trip + checagem de
  "actionability"; 40 campos viravam ~2 s. Agora é ~1 round-trip.
- **Etiquetas `data-whv`**: o scanner marca cada campo, então o lote acha o elemento
  por seletor CSS direto, sem re-consultar por label.
- **Esperas adaptativas** (`src/form/wait.ts`): o bot lê uma assinatura barata da tela
  (URL + readyState + nº de campos + heading) e segue no instante em que ela muda.
  Os valores em `runtime.json` são **teto**, não espera fixa.
- **Multi-passada inteligente**: só re-varre a tela se o lote tinha select/radio/checkbox
  (os únicos que disparam postback/reveal). Tela só de texto avança direto.
- **Clique num round-trip**: acha o botão certo e agenda o clique dentro do mesmo
  `evaluate` (`setTimeout(...,0)`), evitando "execution context destroyed".
- **Rajada na abertura**: 3 marchas (idle 5 min → hot 4 s → rajada 0,9 s nos 60 s
  ao redor do horário). Dorme exatamente até a próxima marcha.
- **Atalho `urls.applyDirect`**: se a calibração revelar a URL direta da nova aplicação,
  o bot pula painel + clique (1-2 s no momento mais caro).
- **`blockHeavyAssets`** (opt-in): corta fonte/vídeo/imagem decorativa. Imagem de
  captcha/challenge nunca é bloqueada.

### O que NÃO foi acelerado, de propósito

O polling da abertura não desce de ~0,9 s. O portal do INZ está atrás de WAF (F5) —
`curl` puro já cai em captcha. Cair em challenge ou perder a sessão custa minutos;
ganhar 400 ms não paga esse risco.

## 7. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| WAF do INZ (F5) derrubar a sessão por parecer bot | poll de 4s + jitter, sessão de Chrome real via CDP, zero rajada |
| Regra do `answers.json` responder errado uma pergunta séria | `defaults.yesNo` só cobre Yes/No; toda pergunta crítica tem regra explícita — **revisar o scan antes do dia** |
| Campo obrigatório sem regra | bot loga, avisa no celular e (se `onUnanswered: pause`) espera você |
| Cartão recusado | cartão reserva + avisar o banco antes |
| Site cair de tanto acesso na abertura | `maxMinutes: 240` — o bot insiste por 4h |

## 8. Depois da inscrição

Pagou = vaga garantida. Aí vem raio-X de tórax e o que mais o INZ pedir por e-mail,
no prazo que eles derem. Processamento: 80% em cerca de 1,5 semana.
