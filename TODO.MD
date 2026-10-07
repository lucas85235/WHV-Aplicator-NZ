# TODO — WHV NZ

## Bloqueadores (só você resolve)
- [ ] Criar a conta no portal WHS do INZ e verificar o e-mail
- [ ] `npm run secrets` → gravar usuário/senha do INZ (o bloco `login` atual é do ImmiAccount australiano)
- [ ] Escolher provedor de seguro e guardar cotação (comprar só quando o INZ pedir ou antes de viajar)
- [ ] Garantir NZD 4.200 no extrato em inglês
- [ ] Cartão Visa/MC com limite ≥ NZD 770 + cartão reserva; avisar o banco
- [ ] Confirmar o horário oficial da abertura em setembro/2026

## Calibração
- [ ] `npm run rehearsal` com a conta criada → validar login e leitura de tela
- [ ] `npm run scan` em cada tela acessível → ajustar `config/answers.json`
- [ ] Decidir `flow.onUnanswered`: `warn` (rápido) ou `pause` (seguro) para o dia D
- [ ] Revisar regra a regra o `answers.json` — principalmente o `defaults.yesNo`

## Velocidade (calibrar no dia)
- [ ] Descobrir a URL direta de "nova aplicação" → `urls.applyDirect` (economiza 1-2 s)
- [ ] Testar `flow.blockHeavyAssets: true` no ensaio; se o portal renderizar normal, deixar ligado
- [ ] Decidir `screenshotMode`: `viewport` (rastro) ou `off` (mais rápido)
- [ ] Conferir se `fillMode: fast` funciona nas telas reais; `safe` é o plano B

## Bot
- [x] Motor genérico validado no `npm run selftest` (fast e safe dão o mesmo resultado)
- [x] Bug: tela Personal ("are you paying by credit card?") era classificada como pagamento
- [x] Bug: postback na mesma tela travava a espera por 15 s (agora 70 ms)
- [x] Re-login no meio do formulário + retomada do rascunho (`resumeApplication`)
- [x] Clique sem efeito não trava mais 15 s (desiste em ~2,5 s e o walk tenta outra coisa)
- [ ] Testar o re-login de verdade contra o INZ (só dá depois da conta criada)
- [ ] Confirmar os textos dos botões de avançar do INZ (`config/selectors.json`)
- [ ] Rodar o watchdog por uma noite pra ver se sobrevive a queda de sessão
- [ ] Deploy 24/7 (VPS/segunda máquina) — herdado do projeto AU, ainda em aberto
- [ ] Rotina que sobe o bot sozinho ao iniciar o Windows

## Legado
- `_au-legacy/` guarda o plano e as páginas do 462 australiano, só como referência.
  Pode apagar quando não precisar mais.
