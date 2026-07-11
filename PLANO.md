# WHV Aplicator — Plano de Projeto

Bot de aplicação automatizada para o **Work and Holiday Visa (subclasse 462)** no
sistema **ImmiAccount** da imigração australiana. Objetivo: no instante em que as
vagas abrem, percorrer todo o formulário e chegar ao pagamento **em segundos**,
mais rápido do que qualquer humano conseguiria manualmente.

> Fonte do processo: `guia-definitivo-whv-australia.pdf`, Parte V (págs. 58–97).

---

## 1. Objetivo e contexto

- O WHV 462 tem **vagas limitadas** que esgotam em **minutos** (em 2025 a 1ª leva
  durou < 10 min; a 2ª, < 5 min).
- As vagas voltam em datas **imprevisíveis** (1º de julho e levas remanescentes em
  datas aleatórias — em 2026 abriram em 02/03 e 09/03).
- O único fator sob nosso controle: **estar 100% preparado e ser veloz** no momento
  da abertura.
- Hoje é impossível simular uma inscrição completa porque o sistema **trava na
  página 6** quando não há vaga (gate de disponibilidade). Por isso o bot precisa
  ser construído com os dados do guia + uma **sessão de calibração** contra a
  aplicação real já salva.

### O gargalo real (descoberta-chave)

O guia documenta que a página de **pagamento (Commonwealth Bank)** tem um cronômetro
de **~10 minutos** ("Minutos restantes para este pagamento"). Ou seja:

```
[login] -> [abrir aplicação salva] -> [Next x14 páginas] -> [GATE de vaga pág.5->6]
        -> [submit now] -> [PÁGINA DE PAGAMENTO: timer 10 min] -> [pagar]
```

> **A corrida termina ao chegar na página de pagamento.** Depois dela há ~10 min de
> folga. Logo, o bot deve otimizar agressivamente tudo **até** o pagamento; a
> digitação do cartão tem margem (mas ainda assim será automatizada para ganhar
> segundos). O código OTP do banco é **sempre manual**.

---

## 2. Estratégia vencedora (modelo de 2 fases)

O próprio guia ensina o truque (págs. 90–94). O bot industrializa isso.

### Fase A — Preparação (dias/semanas antes)
1. Criar a aplicação no ImmiAccount e **preencher tudo** com dados reais.
   - Para conseguir passar do gate e anexar documentos durante a preparação, usa-se
     o truque do guia: na página de passaporte, inserir temporariamente dados de um
     **passaporte de país que ainda tenha vagas** (ex.: Argentina), ir até o fim,
     anexar os 5 documentos e **salvar**.
   - Depois, editar a página de passaporte de volta para os **dados reais
     brasileiros**. Todas as respostas seguem salvas mesmo sem conseguir avançar
     além do gate.
2. **Anexar os 5 documentos** (eles expiram em **30 dias** — fazer o anexo final só
   poucas semanas antes da janela esperada).
3. Rodar o bot em **modo ensaio (rehearsal)** repetidamente: ele navega a aplicação
   salva até o gate, validando todos os seletores e medindo o tempo. Isto resolve o
   problema de "não dá pra testar" — testamos tudo, menos o gate, quantas vezes
   quisermos.

### Fase B — O dia (vagas abrem)
1. Monitor detecta abertura (ou usuário dispara manualmente).
2. Bot: anexa à sessão logada → abre aplicação salva → clica **Next** por todas as
   páginas o mais rápido possível → passa pelo gate → **submit now** → página de
   pagamento → preenche cartão → usuário insere OTP do banco → **pago**.

---

## 3. Stack escolhida

> **Decisões travadas (30/06/2026):** Node + TS + Playwright · controle por **attach
> CDP** ao Chrome logado do usuário · **bot preenche o cartão**, usuário insere só o
> OTP do banco.


| Camada | Escolha | Justificativa |
|---|---|---|
| Runtime | **Node.js + TypeScript** | Node já instalado; tipos evitam erro em config de campos crítica; ótimo tooling de automação. |
| Automação de browser | **Playwright** | API robusta, `codegen` para gravar seletores reais na calibração, Trace Viewer p/ post-mortem, suporte a anexar via **CDP** ao Chrome do usuário (sessão real, menos detecção). |
| Browser | **Chrome real (channel)** ou **attach via CDP** | Usar o Chrome do usuário já logado = sem flags de automação, cookies/2FA preservados, menor chance de detecção. |
| Config/dados | **JSON tipado** (`applicant`, `documents`, `selectors`, `runtime`) | "Deixar tudo pronto" = um arquivo central com cada campo das 14 páginas. |
| Alertas (monitor) | **node-notifier** + som | Avisar abertura de vaga (desktop + áudio). |
| Segredos (cartão) | **arquivo local fora do git** (+ criptografia opcional / OS keychain) | Dados de cartão nunca commitados; `.gitignore` rígido. |
| Logs/diagnóstico | **pino** + screenshots + Playwright trace | Reproduzir e auditar cada passo. |
| Gerenciador de pacotes | **pnpm** (ou npm) | — |

**Por que não Python?** O usuário tem Python 3.14 (muito novo, libs ainda em
catch-up). Node está instalado e o ecossistema Playwright+TS é mais maduro para este
caso. Python+Playwright fica como alternativa equivalente se preferir.

**Por que não um serviço/cloud?** É uma ferramenta **local de uso único e pessoal**.
Rodar do próprio computador do usuário usa a sessão/IP/cartão dele, o que é mais
seguro e menos detectável do que um servidor remoto.

---

## 4. Arquitetura e módulos

```
whv-aplicator/
├─ PLANO.md                      # este documento
├─ package.json
├─ tsconfig.json
├─ .gitignore                    # ignora config/secrets.*, traces, screenshots
├─ config/
│  ├─ applicant.json             # TODOS os dados pessoais (as 14 páginas)
│  ├─ documents.json             # caminhos dos 5 PDFs + tipo + descrição
│  ├─ selectors.json             # seletores por página (calibráveis)
│  ├─ runtime.json               # flags: headless, attach-cdp, retry, modo
│  └─ secrets.local.json         # cartão (NUNCA no git)
├─ src/
│  ├─ index.ts                   # CLI: rehearsal | live | monitor | prepare
│  ├─ browser.ts                 # launch/attach (CDP), contexto persistente
│  ├─ runner.ts                  # orquestrador do hot-path
│  ├─ slot-gate.ts               # detecção do gate + loop de retry
│  ├─ payment.ts                 # preenchimento do checkout CommBank
│  ├─ monitor.ts                 # poll do status de vagas + alerta
│  ├─ documents.ts               # valida/anexa os 5 documentos
│  ├─ pages/                     # 1 módulo por página do formulário
│  │  ├─ p01-terms.ts
│  │  ├─ p02-context.ts
│  │  ├─ p03-passport.ts
│  │  ├─ p05-travel-history.ts
│  │  ├─ p06-australia-history.ts
│  │  ├─ p07-contact.ts
│  │  ├─ p08-correspondence.ts
│  │  ├─ p10-education.ts
│  │  ├─ p11-occupation.ts
│  │  ├─ p12-english.ts
│  │  ├─ p14-health.ts
│  │  ├─ p15-character.ts
│  │  ├─ p16-declarations.ts
│  │  └─ p17-declarations-final.ts
│  ├─ locators.ts                # helpers: byLabel + fallbacks, Yes/No, datas
│  └─ log.ts
└─ artifacts/                    # traces, screenshots, logs (gitignored)
```

### Estratégia de seletores (resiliência)
O ImmiAccount é um formulário server-rendered com **labels de texto consistentes**
(ex.: "Family name", "Country of passport"). Abordagem:
1. **Primário:** localizar por label/texto (`getByLabel`, `getByText`) — sobrevive a
   mudanças de id/classe.
2. **Fallback:** seletor estável de id/name/role gravado na **calibração**.
3. **Yes/No:** helper que acha o grupo de rádio pela pergunta e marca a opção.
4. **Datas:** helper que escreve no formato do site (`18 Oct 2000`).
5. **Dropdowns** (país): selecionar por texto da opção.
6. **Subseções "Add"** (ex.: dupla cidadania, RG): helper que abre, preenche, salva.

---

## 5. Modelo de dados — mapa completo das telas e campos

Isto é o "deixar tudo pronto": cada página com seus campos e a resposta padrão.
Vira o `config/applicant.json`. (17 páginas lógicas; **4, 9 e 13 não existem** para
BR/PT → 14 reais.)

### Pré-formulário
- **Login** (manual pelo usuário) → **New Application**.
- **Seleção de visto:** lista → `Working Holiday Maker` → `Work and Holiday Visa (462)`.

### Página 1 — Termos e Condições
- Aceitar T&C → **Next**.

### Página 2 — Application Context
| Campo | Valor padrão (Brasil) |
|---|---|
| Current Location | País atual (ex.: `Brazil`) → gera *Legal Status* |
| Legal Status | `Citizen` (se cidadão aplicando do próprio país; não gera mais perguntas) |
| *(se não-cidadão)* Why at current location + visa end date | texto livre |
| Application type — 1ª | `First Work and Holiday Visa (subclass 462)` |
| Granted+entered Australia on WHV 462 before? | `No` |
| Accompanied by dependent children? | `No` |
| Granted+entered Australia on WHV 417 before? | `No` |
| Proposed Arrival Date | qualquer data dentro de 1 ano (não influencia) |
| From a country requiring registration before applying? | `No` |
| Has letter of government support? | `No` |

### Página 3 — Passaporte e identidade (CRÍTICA)
| Campo | Fonte |
|---|---|
| Family name | sobrenomes (igual ao passaporte) |
| Given names | nome(s) |
| Sex | Female/Male/Other |
| Date of birth | dd Mon yyyy |
| Passport number | nº passaporte |
| Country of passport | `Brazil` *(na Fase A: país com vaga, ex. Argentina)* |
| Nationality of passport holder | `Brazil` |
| Date of issue | data |
| Date of expiry | data |
| Place of issue / issuing authority | ex.: `SR/DPF/RS` |
| National identity card? | `Yes` → Family name, Given names, Identification number (RG), Country of issue, Date of issue (em branco se não tiver), Date of expiry (em branco) |
| Place of birth | Cidade, Estado, País de nascimento |
| Relationship status | ex.: `Never married` |
| Known by any other name? | `Yes`/`No` (+detalhes) |
| Citizen of country of passport? | `Yes` |
| Citizen of any other country? | `No` (ou `Yes` + país, se dupla cidadania ex. Portugal) |
| Other identity documents not issued by Australia? | `No` (ou `Yes` + CNH/certidão) |
| Health exams for an Australian visa in last 12 months? | `No` (ou `Yes` + HAP ID) |
| Other passports? | `No` (ou `Yes` + dados) |
| Confirmar dados corretos | `Yes` |

> **Página 4 — não existe.**

### Página 5 — Reforço/conferência + histórico de viagem
| Campo | Valor |
|---|---|
| Já viajou/aplicou para visto australiano no passado? | `No` (→ segue direto) / `Yes` (→ detalhes + passaporte usado + Grant Number; deixar Grant em branco se não achar) |

> **GATE DE VAGA aqui (página 5 → 6).** Sem vaga: aviso de indisponibilidade,
> impossível prosseguir. **Não há risco de pagar sem vaga** — só passa quem tem vaga.

### Página 6 — Histórico na Austrália (só com vaga)
- Perguntas adicionais sobre passado na Austrália; se `Yes` → detalhes.

### Página 7 — Residência e contato
| Campo | Valor |
|---|---|
| Usual country of residence | país que considera "casa" (não o atual) |
| Local de entrevista (embaixada) | ex.: `Brasília` (muito improvável ocorrer) |
| Endereço residencial | País, Endereço (número antes da rua), Cidade, Estado, CEP |
| Endereço postal = residencial? | `Yes` (ou `No` + novo endereço) |
| Home phone | 55 + DDD + número, sem símbolos |
| Cell phone | 55 + DDD + número, sem símbolos |
| Email | e-mail (mesmo da conta, p/ evitar verificação extra) |

### Página 8 — Correspondência / agente
- Pergunta sobre autorizar outra pessoa/agente a receber correspondência.
- Sem agente → marcar `No` → **confirmar que o e-mail está correto e verificado**.
- *(Ordem exata das 2 perguntas: validar na calibração.)*

> **Página 9 — não existe.**

### Página 10 — Requisitos educacionais
| Campo | Valor |
|---|---|
| Meets education requirements? | `Yes` |
| Qualificação | `Bachelor Degree` (graduação) ou `Other` (técnico) |
| Nome do curso | — |
| Nome da instituição | — |
| País da instituição | — |
| Data início / Data fim | — |
| Status | `Graduated` ou `Enrolled and deferred` |

### Página 11 — Ocupação
| Campo | Valor |
|---|---|
| Ocupação usual (Brasil) | selecionar |
| Área pretendida na Austrália | selecionar opção real (evitar `Other` — pode atrasar processamento) |

### Página 12 — Inglês funcional
| Campo | Valor |
|---|---|
| Passaporte de USA/UK/Canadá/NZ/Irlanda? | `No` |
| Tem inglês funcional? | `Yes` |
| Como provar | `Completion of an English Language proficiency test ... within last 12 months` |
| Name of test | ex.: IELTS/PTE/etc. |
| Date of test | data (últimos 12 meses) |
| Test reference number | — |
| Country where test undertaken | — |
| Language ability | conforme tabela de notas (ícone de ajuda do site) |
| First language | `Portuguese` |

> **Página 13 — não existe.**

### Página 14 — Saúde (9 perguntas)
- Q1: Nos últimos 5 anos morou/visitou país ≠ passaporte por > 3 meses? → passaporte
  **BR sempre gera exames** (país de risco de TB), independentemente da resposta.
- Q2–Q9: padrão `No` (responder com honestidade; `Yes` abre campos de detalhe).

### Página 15 — Caráter (18 perguntas)
- Todas padrão `No` (responder com honestidade; `Yes` abre detalhes).

### Página 16 — Declarações (5 itens)
- Concordar com as declarações sobre condições do visto, fundos, trabalho secundário.

### Página 17 — Declarações finais (14 itens + valores australianos)
- Concordar com tudo, incluindo declaração de valores australianos.

### Página de revisão
- Resumo de todas as respostas → revisar → **Next**.

### Página de documentos (5 obrigatórios para o 462)
| # | Tipo no site | Conteúdo |
|---|---|---|
| 1 | `Travel Document` | página biográfica do passaporte |
| 2 | `Photograph - Passport` | foto 45×35mm, rosto/ombros, fundo neutro |
| 3 | `Evidence of funds for stay in Australia and departure` | prova de ~AUD$5000 + passagem de saída |
| 4 | `Language Ability - English, Evidence of` | certificado de proficiência |
| 5 | `Qualifications - Overseas, Evidence of` | diploma / histórico (≥2 anos) |

- Formatos: bmp, dcm, doc, docx, dot, gif, jpg, pdf, png, ppt, pptx, rtf, txt, xls, xlsx.
- **≤ 5 MB** por arquivo; multipágina = 1 arquivo só; clicar **Attach** em cada.
- Documentos não-ingleses precisam de **tradução** anexada.
- **NÃO** enviar documentos extras desnecessários (atrasa). Certidão de nascimento
  geralmente **não** é enviada.

### Página de submissão
- **Submit now** (não envia! só avança para o pagamento).

### Página de pagamento (Commonwealth Bank)
| Campo | Valor |
|---|---|
| Valor | AUD **$670** (pode mudar em 01/07/2026) |
| Método | Cartão crédito/débito (ou PayPal/UnionPay/BPay) |
| Nome do titular do cartão | exatamente como no cartão |
| Número do cartão | — |
| Data de validade | `MM/YY` |
| Código de segurança (CVV) | — |
| Endereço de cobrança | **igual ao cadastrado no banco** (reduz recusa) |
| Botão | **Pagar $670,00** |

> **Timer ~10 min.** Após "Pagar", o banco pode exigir **OTP** → **sempre manual**.
> Ter **2º cartão** internacional de bandeira diferente como plano B.

---

## 6. Fluxo do hot-path (pseudo)

```ts
async function live() {
  const page = await attachToLoggedInChrome();      // CDP, sessão real do usuário
  await openSavedApplication(page);                  // dashboard -> Edit aplicação salva
  for (const pg of FORM_PAGES) {                     // p01..p17 (pula 4,9,13)
    await pg.ensureFilled(page, applicant);          // preenche só o que faltar
    await clickNext(page);
    if (pg.id === 'p05') {                            // GATE
      const ok = await slotGate.passOrRetry(page);   // detecta indisponibilidade
      if (!ok) continue;                             // loop de retry controlado
    }
  }
  await reviewPage.confirm(page);
  await documents.ensureAllAttached(page);           // já anexados na Fase A
  await clickSubmitNow(page);
  await payment.fill(page, secrets.card);            // preenche checkout CommBank
  notify('Pague: insira o OTP do banco AGORA');      // handoff p/ usuário (OTP)
}
```

### Loop do gate (sensível)
- Detecta o aviso de "sem vaga" por texto.
- Re-tenta (re-clicar Next / reabrir aplicação) em intervalo **calibrado**.
- **Importante:** não martelar o servidor a ponto de parecer DoS / levar
  rate-limit/bloqueio de IP. Intervalo de retry configurável e conservador.

---

## 7. Anti-detecção e sessão

- **Login manual** pelo usuário (não automatizar credenciais/2FA — frágil e
  arriscado). O bot **anexa** à sessão já logada via **CDP**
  (`chrome --remote-debugging-port=9222`).
- Modo **headed** (visível) para o usuário acompanhar e intervir (CAPTCHA, OTP).
- Sem `slowMo` no hot-path — o objetivo é velocidade.
- Contexto persistente (cookies/sessão preservados entre execuções).
- Tratar **timeout de sessão** do ImmiAccount: logar pouco antes da janela; manter
  atividade mínima.
- **CAPTCHA / verificação:** bot pausa e espera o humano resolver, depois continua.

---

## 8. Monitor de vagas (opcional, mas recomendado)

- Poll periódico da **página pública de status de vagas** do 462 + checagem do gate.
- Ao detectar abertura: **alerta sonoro + notificação desktop** e, se configurado,
  **dispara o `live()` automaticamente**.
- Backup humano: grupos/avisos da comunidade (o guia enfatiza isso).

---

## 9. Riscos e considerações

| Risco | Mitigação |
|---|---|
| **Não dá pra testar o gate/pagamento real** agora | Modo *rehearsal* contra a aplicação salva (tudo menos gate); calibração de seletores; trace. |
| Mudança de layout do ImmiAccount | Seletores por label + fallback; re-calibrar via `codegen` perto da data. |
| Detecção de automação / bloqueio | Attach CDP à sessão real, headed, retry conservador, IP residencial do usuário. |
| **ToS:** automatizar site do governo pode violar termos | Decisão do usuário. A aplicação é **legítima e verdadeira** (dados reais do próprio usuário); apenas a automação é a zona cinzenta. Declarar isso abertamente. |
| Recusa de cartão / fraude | 2 cartões, avisar banco, endereço = banco, OTP manual. |
| Documentos expiram em 30 dias | Anexo final só semanas antes da janela. |
| Erro de validação trava o Next | Pré-validar tudo no rehearsal; bot detecta e avisa. |
| OTP do banco | Sempre manual; bot faz handoff com alerta. |

> **Nota de honestidade:** mentir/omitir no formulário pode causar **negação do
> visto ou banimento de até 10 anos**. Todos os dados de `applicant.json` devem ser
> **verdadeiros**. O único dado temporariamente "falso" é o país de passaporte na
> Fase A (truque do guia, só para pré-salvar) — **revertido para o real antes de
> submeter**.

---

## 10. Plano de calibração (resolve o "não dá pra testar")

1. Usuário cria e salva a aplicação real no ImmiAccount (Fase A).
2. Com a aplicação salva, rodar `playwright codegen` navegando as páginas reais
   (dá pra ir até o gate mesmo sem vaga) → capturar seletores estáveis de cada
   campo → preencher `selectors.json`.
3. Rodar `rehearsal` ponta-a-ponta (login → Next até o gate) medindo tempo e
   confirmando que cada página é reconhecida e preenchida.
4. Iterar até o rehearsal passar limpo, repetidamente, sem intervenção.

---

## 11. Roadmap / milestones

- [ ] **M0 — Setup:** projeto Node+TS+Playwright, `.gitignore`, esqueleto de pastas.
- [ ] **M1 — Config:** `applicant.json` + `documents.json` preenchidos com dados reais.
- [ ] **M2 — Attach/sessão:** anexar via CDP ao Chrome logado; abrir aplicação salva.
- [ ] **M3 — Páginas:** implementar `pages/*` com preenche+verifica por página.
- [ ] **M4 — Gate:** detecção + loop de retry controlado.
- [ ] **M5 — Documentos:** validação e anexo dos 5 arquivos.
- [ ] **M6 — Pagamento:** preenchimento do checkout + handoff de OTP.
- [ ] **M7 — Rehearsal:** execução ponta-a-ponta até o gate, com trace e timing.
- [ ] **M8 — Calibração:** `codegen` na aplicação real, finalizar seletores.
- [ ] **M9 — Monitor:** poll + alerta + auto-disparo.
- [ ] **M10 — Dia D:** checklist final, 2º cartão, ensaio na véspera.

---

## 12. Próximos passos imediatos

1. Confirmar a stack (Node+TS+Playwright) e a abordagem de **attach via CDP**.
2. Gerar M0+M1: esqueleto do projeto + `applicant.json` com os campos deste mapa
   (preencho a estrutura; usuário insere os valores reais).
3. Implementar o runner e as primeiras páginas, validando em rehearsal assim que a
   aplicação salva existir.

> Documento vivo — atualizar conforme a calibração revelar o DOM real e conforme a
> imigração mudar o formulário.
