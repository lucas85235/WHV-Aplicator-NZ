# WHV Aplicator NZ

Bot que se inscreve no **Working Holiday Visa da Nova Zelândia** (esquema Brasil)
no instante em que a cota abre. Adaptado do aplicador do WHV 462 australiano.

**Abertura da cota:** 08 Out 2026, 10:00 NZDT → **07 Out 2026, 17:00 em Manaus**
(18:00 Brasília). **300 vagas.** Em 2025 acabaram em **menos de 8 minutos**.

## Diferença para o projeto australiano

| | Austrália (462) | Nova Zelândia (WHS) |
|---|---|---|
| Sistema | ImmiAccount | portal WHS do INZ (sistema antigo) |
| Dá pra pré-salvar a aplicação? | Sim | **Não** — o botão de aplicar só existe com a cota aberta |
| Gargalo | gate da página 5→6 | preencher o formulário inteiro em minutos |
| Documentos | 5 uploads obrigatórios | quase nada no ato; INZ pede depois por e-mail |
| Pagamento | Commonwealth Bank | gateway NZ (Visa/Mastercard), a partir de NZD 770 |

Como o formulário **não pode ser visto antes da abertura**, o bot não usa seletores
fixos: ele **varre o DOM em runtime**, identifica cada campo pelo texto da pergunta
e responde pelo *livro de respostas* (`config/answers.json`).

## Stack
Node + TypeScript + Playwright. Anexa via **CDP** ao Chrome real logado pelo usuário
(o portal do INZ fica atrás de WAF — sessão de navegador de verdade evita captcha).

## Setup
```bash
npm install
npm run secrets      # grava login do INZ (senha oculta, só local, fora do git)
npm run typecheck
```

Preencha com dados **reais**:
- `config/applicant.json` — seus dados
- `config/answers.json` — como responder cada pergunta (regex → valor)
- `config/documents.json` — arquivos prontos
- `config/secrets.local.json` — login do INZ + cartão (nunca commitado)

## Uso
```bash
npm run open        # abre o Chrome dedicado (porta 9222) na tela de login do INZ
npm run login       # testa o login
npm run rehearsal   # ensaio: loga, checa a cota, mede a cobertura do answers.json
npm run scan        # calibração: dumpa os campos da tela atual em artifacts/
npm run when        # quanto falta pra abertura
npm run watch       # só vigia e alarma (não preenche)
npm run live        # dia D: espera a cota, preenche tudo, para no pagamento
npm run selftest    # valida o livro de respostas num formulário fake + benchmark
```

## Como funciona o livro de respostas
Cada campo da tela vira uma **chave de busca** (`pergunta | label | name | seletor`).
A primeira regra do `answers.json` cujo `match` (regex) casar define a resposta.
Perguntas Yes/No não cobertas caem no `defaults.yesNo` (hoje `"No"`).

```json
{ "id": "sobrenome", "match": "family name|surname|last name", "value": "{{personal.familyName}}" }
```

`npm run scan` mostra, campo a campo, qual regra casou e o que ficou sem resposta —
é assim que se calibra.

## Estado atual — leia antes de confiar

**Verificado** (roda `npm run selftest`):
- Compila, CLI funciona, 26/26 campos respondidos certo num formulário fake do INZ
- `fast` e `safe` produzem resultado idêntico
- 5 testes de regressão passam (inclusive 3 bugs reais já corrigidos)

**NÃO verificado** — o bot nunca viu o portal do INZ, porque a conta ainda não existe:
- Login (campos, RealMe, 2FA, captcha do WAF)
- Detecção de "cota aberta" — as regex são palpite fundamentado, não calibração
- Textos dos botões de avançar
- Tela de pagamento (qual gateway, quais campos)
- Como o WAF reage à rajada de 0,9 s

Ou seja: **é à prova de estrago, não à prova de erro.** Quando não entende a tela,
ele para, dispara alarme + push e devolve o controle — nunca chuta em campo sério
nem paga sozinho. Mas ainda vai errar telas que nunca viu.

O que destrava tudo: **criar a conta e rodar `npm run rehearsal` + `npm run scan`.**

## Velocidade
Preenchimento em **lote** (uma tela inteira por round-trip), esperas **adaptativas**
(sem `sleep` fixo) e **rajada** de checagem nos 60 s ao redor do horário de abertura.
Medição no `npm run selftest`: 198 ms por tela contra 630 ms campo a campo.
Detalhes e o que ficou de fora de propósito: [PLANO-NZ.md](PLANO-NZ.md#6-latência--o-que-foi-otimizado).

```bash
npm run selftest    # formulário fake: valida as respostas e mede fast vs safe
```

## Avisos
- Os dados devem ser **verdadeiros**. Mentir em formulário de imigração = recusa e banimento.
- O bot **nunca paga sozinho**: preenche o cartão e para. OTP/3-D Secure é sempre seu.
- Automatizar o portal pode conflitar com os ToS do INZ — risco assumido pelo usuário.
  Por isso o polling nunca vira flood: rajada de 0,9 s só nos ~60 s ao redor da abertura,
  4 s na janela quente, 5 min o resto do tempo.
- `config/secrets.local.json`, `assets/` e `artifacts/` estão no `.gitignore`.

Plano completo e checklist: [PLANO-NZ.md](PLANO-NZ.md) · Como rodar no dia: [COMO_RODAR.md](COMO_RODAR.md)
