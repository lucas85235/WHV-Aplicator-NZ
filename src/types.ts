// Tipos das configuracoes. applicant/answers/documents/selectors sao dirigidos por
// dados (o usuario edita o JSON); runtime e tipado pois o codigo le campo a campo.

export interface RuntimeConfig {
  browser: {
    mode: "attach-cdp" | "launch";
    cdp: { host: string; port: number };
    launchFallback: { channel: string; headless: boolean; userDataDir: string };
  };
  timeouts: { defaultMs: number; navigationMs: number };
  /** Espera pela abertura da cota (8 Out 2026 10:00 NZDT). */
  opening: {
    /** Segundos antes/depois do horario oficial em que checa em rajada curta. */
    burstSeconds: number;
    /** Intervalo dentro da rajada. Nao descer de ~700ms (WAF). */
    burstPollMs: number;
    /** ISO com offset. Ex: "2026-10-07T21:00:00Z" (= 10:00 NZDT de 08/10). */
    isoUtc: string | null;
    /** Comeca a bater na porta X segundos ANTES do horario oficial. */
    leadSeconds: number;
    /** Intervalo entre checagens quando ainda falta muito tempo. */
    idlePollMs: number;
    /** Intervalo na janela quente (perto/depois do horario). Nao baixar demais: WAF. */
    hotPollMs: number;
    /** Jitter aleatorio somado ao intervalo (anti-padrao de bot). */
    jitterMs: number;
    /** Desiste depois de N minutos sem abrir. */
    maxMinutes: number;
  };
  payment: { autofillCard: boolean; stopBeforePay: boolean; alarm: boolean };
  flow: {
    onError: "skip" | "pause";
    /** fast = escreve a tela toda num round-trip. safe = campo a campo (lento). */
    fillMode: "fast" | "safe";
    /** Quantas re-varreduras por tela (pega campos revelados por postback). */
    maxFillPasses: number;
    /** Teto da espera adaptativa depois de escrever/clicar. */
    settleMs: number;
    /** Teto da espera pela troca de tela apos clicar em avancar. */
    navMaxMs: number;
    /** off = mais rapido. viewport = barato. full = pagina inteira (lento). */
    screenshotMode: "off" | "viewport" | "full";
    fillOnlyEmpty: boolean;
    /** assist: avanca sozinho quando a tela fica sem pendencia nem erro. Default true. */
    autoAdvance?: boolean;
    /** Bloqueia fonte/video/imagem decorativa (menos bytes = pagina abre antes).
     * OPT-IN: testar no ensaio antes. Imagem de captcha/challenge nunca e bloqueada. */
    blockHeavyAssets: boolean;
    /** Max de telas percorridas numa passada (guarda contra loop infinito). */
    maxSteps: number;
    /** Se sobrar campo obrigatorio sem resposta: avisa e segue, ou para. */
    onUnanswered: "warn" | "pause";
  };
  artifactsDir: string;
  urls: {
    /** Portal de login do sistema Working Holiday (sistema antigo do INZ). */
    whsLogin: string;
    /** Pagina publica do esquema Brasil (usada pelo monitor). */
    schemeInfo: string;
    /** Atalho: URL direta de "nova aplicacao", se descoberta na calibracao.
     * Com ela o bot pula o carregamento do painel + o clique (economiza 1-2s). */
    applyDirect: string | null;
  };
  /** Esquema a selecionar na lista do INZ (regex, ex: "brazil"). Default: brazil. */
  scheme?: string;
}

export type JsonRecord = Record<string, unknown>;

export interface Card {
  holderName: string;
  number: string;
  expiry: string;
  cvv: string;
}

export interface LoginCreds {
  username?: string;
  password?: string;
  totpSecret?: string; // base32 do authenticator, SE o INZ pedir 2FA
}

export interface NotifyConfig {
  telegram?: { botToken: string; chatId: string };
  ntfyTopic?: string;
  webhookUrl?: string;
}

export interface Secrets {
  card: Card;
  billingAddress: JsonRecord;
  backupCard?: Card;
  login?: LoginCreds;
  notify?: NotifyConfig;
}

/** Uma regra do "livro de respostas": casa por regex e diz o que responder. */
export interface AnswerRule {
  /** Rotulo so pra log. */
  id: string;
  /** Regex (string) testada contra pergunta+label+name+id do campo. */
  match: string;
  /** Regex opcional que, se casar, DESCARTA a regra (evita falso positivo). */
  not?: string;
  /** Restringe o tipo de campo. */
  kind?: FieldKind;
  /** Valor a preencher / opcao a marcar. "@skip" = deixa pro humano. */
  value: string;
}

export interface AnswerBook {
  rules: AnswerRule[];
  defaults: {
    /** Resposta padrao dos grupos Yes/No nao casados (saude/carater). */
    yesNo: string | null;
    /** Marca todos os checkboxes em paginas de declaracao. */
    checkDeclarations: boolean;
  };
}

export type FieldKind = "text" | "textarea" | "select" | "radio" | "checkbox" | "date" | "file";

export interface AppConfig {
  applicant: JsonRecord;
  answers: AnswerBook;
  documents: { documents: Array<JsonRecord> } & JsonRecord;
  selectors: JsonRecord;
  runtime: RuntimeConfig;
  secrets: Secrets | null;
}
