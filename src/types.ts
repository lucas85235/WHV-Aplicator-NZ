// Tipos das configuracoes. applicant/documents/selectors sao dirigidos por dados
// (o usuario edita o JSON), entao ficam frouxos; runtime e tipado pois o codigo le.

export interface RuntimeConfig {
  browser: {
    mode: "attach-cdp" | "launch";
    cdp: { host: string; port: number };
    launchFallback: { channel: string; headless: boolean; userDataDir: string };
  };
  timeouts: { defaultMs: number; navigationMs: number };
  gateRetry: { enabled: boolean; intervalMs: number; maxMinutes: number };
  payment: { autofillCard: boolean; stopBeforePay: boolean; alarm: boolean };
  flow: {
    startMode: "resume" | "new";
    onError: "skip" | "pause";
    screenshotEachPage: boolean;
    fillOnlyEmpty: boolean;
  };
  monitor: {
    statusUrl: string | null;
    pollIntervalMs: number;
    autoStartLive: boolean;
    alertSound: boolean;
  };
  artifactsDir: string;
  urls: { immiAccountLogin: string };
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
  totpSecret?: string; // chave base32 do authenticator (TOTP)
}

export interface Secrets {
  card: Card;
  billingAddress: JsonRecord;
  backupCard?: Card;
  login?: LoginCreds;
}

export interface AppConfig {
  applicant: JsonRecord;
  documents: { documents: Array<JsonRecord> };
  selectors: JsonRecord;
  runtime: RuntimeConfig;
  secrets: Secrets | null;
}
