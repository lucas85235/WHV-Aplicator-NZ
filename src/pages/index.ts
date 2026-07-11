import type { Page } from "playwright";
import type { AppConfig } from "../types.js";
import { tryAction } from "../util.js";
import { fillLabel, setDate, selectDropdown, selectDropdownByOption, selectCountryByOrder, setRadioInGroup, answerAllRadios, checkAllCheckboxes, checkByLabel, fillFirstEmptyText, clickButton, toAscii } from "../locators.js";
import { log } from "../log.js";

export interface PageContext {
  page: Page;
  cfg: AppConfig;
}
export interface FormPage {
  id: string;
  title: string;
  handle(ctx: PageContext): Promise<void>;
}

type A = Record<string, unknown>;
const sec = (cfg: AppConfig, key: string): A => ((cfg.applicant as A)[key] as A) ?? {};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const cap = (v: unknown): string | null => {
  const s = str(v);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
};
const yn = (v: unknown): "Yes" | "No" => (str(v) === "yes" ? "Yes" : "No");

type Act = (name: string, fn: () => Promise<void>) => Promise<boolean>;
function make(id: string, title: string, fn: (ctx: PageContext, act: Act) => Promise<void>): FormPage {
  return {
    id,
    title,
    async handle(ctx) {
      const onErr = ctx.cfg.runtime.flow.onError;
      const act: Act = (name, f) => tryAction(name, f, onErr);
      await fn(ctx, act);
    },
  };
}

// ===== PAGINAS 2-4: CALIBRADAS no DOM real (textos exatos) ===================

const p02 = make("page02_context", "Application Context", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page02_context");
  await act("current location", () => selectDropdown(page, "Current location", str(s["currentLocation"])));
  await act("legal status", () => selectDropdown(page, "Legal status", str(s["legalStatus"])));
  await act("application type", () => setRadioInGroup(page, "Select the type of work and holiday visa", str(s["applicationType"]) ?? "First Work and Holiday visa (subclass 462)"));
  await act("entered 462 before", () => setRadioInGroup(page, "granted and entered Australia on a first Work and Holiday visa (subclass 462) before", yn(s["grantedEnteredWHV462Before"])));
  await act("dependent children", () => setRadioInGroup(page, "accompanied by dependent children", yn(s["accompaniedByDependentChildren"])));
  await act("entered 417 before", () => setRadioInGroup(page, "granted and entered Australia on a Working Holiday visa (subclass 417) before", yn(s["grantedEnteredWHV417Before"])));
  await act("proposed arrival date", () => setDate(page, "Proposed arrival date", str(s["proposedArrivalDate"])));
  await act("registration required", () => setRadioInGroup(page, "required to submit a registration before applying", yn(s["fromCountryRequiringRegistration"])));
  await act("government support", () => setRadioInGroup(page, "letter of government support", yn(s["hasLetterOfGovernmentSupport"])));
});

const p03 = make("page03_passport", "Passport & Identity", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page03_passport");
  const pob = (s["placeOfBirth"] as A) ?? {};
  await act("family name", () => fillLabel(page, "Family name", str(s["familyName"])));
  await act("given names", () => fillLabel(page, "Given names", str(s["givenNames"])));
  await act("sex", () => setRadioInGroup(page, "Sex", cap(s["sex"]) ?? "Male"));
  await act("date of birth", () => setDate(page, "Date of birth", str(s["dateOfBirth"])));
  await act("passport number", () => fillLabel(page, "Passport number", str(s["passportNumber"])));
  await act("country of passport", () => selectDropdown(page, "Country of passport", str(s["countryOfPassport"])));
  await act("nationality", () => selectDropdown(page, "Nationality of passport holder", str(s["nationalityOfPassportHolder"])));
  await act("passport issue date", () => setDate(page, "Date of issue", str(s["dateOfIssue"])));
  await act("passport expiry date", () => setDate(page, "Date of expiry", str(s["dateOfExpiry"])));
  await act("place of issue", () => fillLabel(page, "Place of issue", str(s["placeOfIssue"])));
  await act("has national id card", () => setRadioInGroup(page, "national identity card", yn(s["hasNationalIdentityCard"])));
  await act("birth town", () => fillLabel(page, "Town / City", str(pob["city"])));
  await act("birth state", () => fillLabel(page, "State / Province", str(pob["state"])));
  await act("country of birth", () => selectDropdown(page, "Country of birth", str(pob["country"])));
  await act("relationship status", () => selectDropdown(page, "Relationship status", str(s["relationshipStatus"])));
  await act("known by other name", () => setRadioInGroup(page, "known by any other names", yn(s["knownByOtherName"])));
  await act("citizen of passport country", () => setRadioInGroup(page, "citizen of the selected country of passport", yn(s["citizenOfCountryOfPassport"])));
  await act("citizen of other country", () => setRadioInGroup(page, "citizen of any other country", yn(s["citizenOfOtherCountry"])));
  await act("other passports", () => setRadioInGroup(page, "other current passports", yn(s["hasOtherPassports"])));
  await act("other identity docs", () => setRadioInGroup(page, "other identity documents", yn(s["otherIdentityDocsNonAustralian"])));
  await act("health exam 12m", () => setRadioInGroup(page, "health examination for an Australian visa in the last 12 months", yn(s["healthExamsForAuVisaLast12Months"])));
});

const p04 = make("page04_confirm", "Critical Data Confirmation", async ({ page }, act) => {
  await act("confirm critical data", () => setRadioInGroup(page, "Is the above information correct", "Yes"));
});

// ===== PAGINAS POS-GATE: BLIND (nao daria pra ver sem passar do gate) ========
// Textos do guia. Best-effort; calibrar no dia se o gate abrir.

const p06 = make("page06_history", "Additional identity questions", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page05_travel_history");
  await act("travelled/applied AU visa before", () => setRadioInGroup(page, "previously travelled to Australia or previously applied for a visa", yn(s["traveledOrAppliedAuVisaBefore"])));
});

const p07 = make("page07_contact", "Residence & Contact", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page07_contact");
  const addr = (s["residentialAddress"] as A) ?? {};
  await act("usual country of residence", () => selectCountryByOrder(page, 0, str(s["usualCountryOfResidence"])));
  await act("interview office (texto)", () => fillLabel(page, "Office", str(s["interviewLocationEmbassy"])));
  await act("res country", () => selectCountryByOrder(page, 1, str(addr["country"])));
  await act("res address", () => fillLabel(page, "Address", str(addr["address"])));
  await act("res suburb/town", () => fillLabel(page, "Suburb / Town", str(addr["city"])));
  await act("res state", () => fillLabel(page, "State or Province", str(addr["state"])));
  await act("res postcode", () => fillLabel(page, "Postal code", str(addr["postcode"])));
  await act("postal same", () => setRadioInGroup(page, "postal address the same as the residential", yn(s["postalSameAsResidential"])));
  await act("home phone", () => fillLabel(page, "Home phone", str(s["homePhone"])));
  await act("mobile", () => fillLabel(page, "Mobile / Cell phone", str(s["cellPhone"])));
  await act("email", () => fillLabel(page, "Email", str(s["email"])));
});

const p08 = make("page08_correspondence", "Correspondence / Recipient", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page08_correspondence");
  const c7 = sec(cfg, "page07_contact");
  // 1 radio unico. Solo = "No". (yn -> "No"/"Yes"; opcao "No" existe).
  await act("authorised recipient", () => setRadioInGroup(page, "authorise another person to receive written correspondence", yn(s["authorizeOtherToReceive"])));
  await page.waitForTimeout(1500); // radio dispara postback AJAX; sem esperar, Next -> "An error has occurred"
  // Electronic communication: email revelado mesmo com "No".
  await act("correspondence email", () => fillLabel(page, "Email address", str(s["correspondenceEmail"]) ?? str(c7["email"])));
});

const p10 = make("page10_education", "Education", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page10_education");
  await act("meets education req", () => setRadioInGroup(page, "meet the education requirements", yn(s["meetsEducationRequirements"])));
  await page.waitForTimeout(1200); // postback: revela a tabela de estudos
  if (yn(s["meetsEducationRequirements"]) === "No") return;
  // ja existe linha de estudo? nao duplica (protege re-execucao / app pre-salva)
  const hasRow = await page.evaluate(() => {
    const t = [...document.querySelectorAll("table")].find((tb) => /qualification/i.test(tb.textContent || ""));
    return t ? [...t.querySelectorAll("tbody tr")].some((tr) => tr.querySelectorAll("td").length > 1 && (tr.textContent || "").trim().length > 8) : false;
  });
  if (hasRow) { log.info("education: ja tem linha de estudo -> nao adiciona"); return; }
  // abre subpagina "Education history" e preenche o estudo
  await act("abrir Add estudo", () => clickButton(page, "Add"));
  await page.waitForTimeout(1100);
  // selects/datas do ImmiAccount disparam postback AJAX ao mudar -> settle entre cada
  await act("qualification", () => selectDropdown(page, "Qualification", str(s["qualification"])));
  await page.waitForTimeout(500);
  await act("course name", () => fillLabel(page, "Course name", str(s["courseName"])));
  await act("institution name", () => fillLabel(page, "Institution name", str(s["institutionName"])));
  await act("country of institution", () => selectDropdown(page, "Country of institution", str(s["institutionCountry"])));
  await page.waitForTimeout(500);
  await act("date from", () => setDate(page, "Date from", str(s["startDate"])));
  await page.waitForTimeout(400);
  await act("date to", () => setDate(page, "Date to", str(s["endDate"])));
  await page.waitForTimeout(400);
  await act("status", () => selectDropdown(page, "Status", str(s["status"])));
  await page.waitForTimeout(1600); // settle antes do Confirm (senao "An error has occurred")
  await act("confirmar estudo", () => clickButton(page, "Confirm"));
  await page.waitForTimeout(1300);
});

const p11 = make("page11_occupation", "Occupation", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page11_occupation");
  // ocupacao usual = campo de TEXTO (nao dropdown)
  await act("usual occupation (texto)", () => fillLabel(page, "occupation", str(s["usualOccupationInBrazil"])));
  // area pretendida = dropdown de industrias (match pela opcao)
  await act("intended field", () => selectDropdownByOption(page, str(s["intendedFieldInAustralia"])));
});

const p12 = make("page12_english", "Functional English", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page12_english");
  const test = (s["test"] as A) ?? {};
  // Q1 passaporte de pais de ingles nativo (No). Postback revela Q2.
  await act("passaporte pais ingles nativo", () => setRadioInGroup(page, "hold a current passport from the USA", yn(s["holdsPassportFromNativeEnglishCountry"])));
  await page.waitForTimeout(1400);
  if (yn(s["holdsPassportFromNativeEnglishCountry"]) === "No") {
    // Q2 tem ingles funcional (Yes). Postback revela os metodos de prova (checkboxes).
    await act("tem ingles funcional", () => setRadioInGroup(page, "at least functional English language ability", yn(s["hasFunctionalEnglish"])));
    await page.waitForTimeout(1400);
    if (yn(s["hasFunctionalEnglish"]) === "Yes") {
      if (str(test["nameOfTest"])) {
        // teste realmente feito -> marca a opcao do teste e preenche os detalhes
        await act("prova: teste de ingles", () => checkByLabel(page, "Completion of an English language proficiency test"));
        await page.waitForTimeout(1200);
        await act("test name", () => fillLabel(page, "Name of test", str(test["nameOfTest"])));
        await act("test date", () => setDate(page, "Date of test", str(test["dateOfTest"])));
        await act("test ref", () => fillLabel(page, "reference number", str(test["testReferenceNumber"])));
        await act("language ability", () => selectDropdown(page, "Language ability", str(test["languageAbility"])));
      } else {
        // SEM teste feito -> "Other" + texto honesto (IELTS agendado, a fornecer). NAO marca teste falso.
        log.warn("page12: sem teste -> 'Other' + texto (ingles pendente). So valido se agendou IELTS.");
        await act("prova: Other", () => checkByLabel(page, "Other"));
        await page.waitForTimeout(1200);
        // FORCA overwrite do "Give details" (fillOnlyEmpty pularia se ja tiver texto antigo).
        await act("texto 'Give details' (overwrite)", async () => {
          const ta = page.locator("textarea").filter({ visible: true }).first();
          if (await ta.count()) {
            await ta.fill(toAscii(str(s["proofOtherText"]) ?? ""));
            await page.waitForTimeout(300);
            await ta.blur().catch(() => {}); // commit (senao Next -> "An error has occurred")
            await page.waitForTimeout(1200);
          }
        });
      }
    }
  }
  await act("main language", () => selectDropdown(page, "Main language", str(s["firstLanguage"])));
  await page.waitForTimeout(700);
});

const p14 = make("page14_health", "Health", async ({ page }, act) => {
  await act("saude: marcar No nos grupos vazios", async () => {
    const n = await answerAllRadios(page, "No");
    log.info({ grupos: n }, "health: radios 'No'");
  });
});

const p15 = make("page15_character", "Character", async ({ page }, act) => {
  await act("carater: marcar No nos grupos vazios", async () => {
    const n = await answerAllRadios(page, "No");
    log.info({ grupos: n }, "character: radios 'No'");
  });
});

const p16 = make("page16_declarations", "Declarations", async ({ page, cfg }, act) => {
  const s = sec(cfg, "page16_declarations");
  if (s["agreeAll"] === false) return;
  // 5 grupos de radio (atestacoes). Todas = "Yes" (entende/concorda). Nao sao checkboxes.
  await act("declaracoes W&H: Yes em todos os grupos", async () => {
    const n = await answerAllRadios(page, "Yes");
    log.info({ grupos: n }, "page16: declaracoes marcadas Yes");
  });
  await act("checkboxes extras (se houver)", () => checkAllCheckboxes(page));
  await page.waitForTimeout(700);
});

const p17 = make("page17_declarations_final", "Final Declarations", async ({ page }, act) => {
  await act("declaracoes finais: marcar tudo", () => checkAllCheckboxes(page));
});

// GATE fica DEPOIS da p04_confirm (pagina 5->6 da imigracao).
export const GATE_AFTER = "page04_confirm";

export const FORM_PAGES: FormPage[] = [p02, p03, p04, p06, p07, p08, p10, p11, p12, p14, p15, p16, p17];

// Despacho por HEADING (Edit pode abrir em qualquer ponto; paginas 4/9/13 nao
// existem). A ordem importa: mais especifico primeiro.
export const PAGE_MATCHERS: { re: RegExp; page: FormPage }[] = [
  { re: /application context/i, page: p02 },
  { re: /passport details|primary applicant/i, page: p03 },
  { re: /critical data confirmation/i, page: p04 },
  { re: /movements|travel history|previous travel|visas? held|been to australia/i, page: p06 },
  // p08 ANTES de p07: "Authorised recipient contact details" (pg8) contem "contact details".
  { re: /correspondence|authorised recipient|electronic communication|receiving/i, page: p08 },
  { re: /(?<!recipient )contact details|residential address|usual country of residence/i, page: p07 },
  { re: /education/i, page: p10 },
  { re: /occupation|employment/i, page: p11 },
  { re: /english/i, page: p12 },
  { re: /health/i, page: p14 },
  { re: /character/i, page: p15 },
  { re: /declaration/i, page: p16 },
];
