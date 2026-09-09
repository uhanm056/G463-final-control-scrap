# CLAUDE.md — Prefix Dashboards (Yanfeng Planá n.L.)

Kontext pro Claude Code. Přečti si to na začátku každé session a drž se toho.

## Co to je

Interaktivní HTML dashboard pro linku **G463 Prefix** (door trim panely) v závodě
Yanfeng Planá nad Lužnicí. Od 9/2026 jeden soubor `docs/index.html`, dvě záložky: **Domů** a **Data & metodika**.
Domů = 4 dlaždice, jedna na každý zdrojový Excel: Finální kontrola Prefix (L1 a L2 vedle sebe) ·
200% kontrola sklad (report CZ26027, dřív „Kontrola MC“) · Quality posouzení (PREFIX a SKLAD vedle sebe) ·
Scrap PCO001. Klik na dlaždici rozbalí detail POD dlaždicemi (Pareto, trendy, tabulky; `#tab=0&d=prefix|mc|pos|scrap`).
`#tab=0&tv` = režim pro TV (jen dlaždice 2×2, hodiny, reload 15 min). Záložka „Přehled“ byla zrušena (uživateli
přišla nepřehledná).
Nahrazuje původní dva soubory (`dashboard_PREFIX_W28.html`, `dashboard_SCRAP_PCO001.html`).

Struktura repa: `src/` (parser.js, charts.js, app.js, styles.css, template.html) →
`node build.js` → `docs/index.html` (inline SheetJS z `vendor/`, data z `data/`).
Testy: `node test/parser.test.js`. Grafy jsou čisté SVG (bez Chart.js/Canvas).
Vzhled = styl aplikace Quality loss report (repo `uhanm056/Quality-loss-report-Scrap`, `css/styles.css`):
paleta Yanfeng (--dark #1B3A5C, --mid #2E6DA4, --accent #E8A020, --green #27AE60, --red #C0392B),
gradientová hlavička, oranžová aktivní záložka, stavový banner dne (ok/warn/bad), KPI s barevným proužkem.
Červená je jen pro stav a scrap, ne pro série v grafech.

Uživatel: Milan, Operations Manager. Komunikace česky.

## Prostředí — TVRDÁ OMEZENÍ

Shopfloor síť a zobrazení na TV kladou omezení, která se NESMÍ porušit:

- **Žádné CDN.** Shopfloor síť blokuje Google Fonts i cdnjs. Chart.js a SheetJS
  musí být **inline v souboru** (npm registry funguje, cdnjs ne).
- **Fonty offline:** od 9/2026 `'Segoe UI', Arial` (systémové na Windows), čísla `tabular-nums`.
  Dřív Arial + Consolas. Žádný `@import` z Google Fonts.
- **Canvas + SVG fallback.** Na TV někdy chybí GPU akcelerace → Canvas se nevykreslí.
  Po ~600 ms fallback na SVG render.
- **Self-contained HTML.** Jeden soubor, žádný build. Deploy = hodit na GitHub Pages
  nebo OneDrive. Otevírá se v Edge/Chrome.
- localStorage je per-prohlížeč — každý PC/prohlížeč má vlastní cache.

## Datová pravidla — NIKDY neporušit

Tohle jsou explicitní pravidla od uživatele, ověřená v praxi:

1. **L1 a L2 vždy odděleně.** Počítej a zobrazuj Linku 1 a Linku 2 samostatně.
   Combined slouží JEN jako celkový přehled pro management/zákazníka.
   Procesní analýza je vždy per linka.

2. **RAG status — barva i číslo ze STEJNÉHO výpočtu.** Prosté porovnání posledního
   období s předchozím (W_n vs W_n-1):
   - QC dashboard: delta v procentních bodech (pp), práh ±2pp
   - Scrap dashboard: relativní %, práh ±25 %; zero-baseline case zvlášť
     (prev=0 & last>50€ → RED; prev>50 & last=0 → GREEN)
   - **Nikdy nepoužívat průměr 2 týdnů** — vede k nekonzistenci mezi číslem a barvou.

3. **Top 5 = Pareto dle posledního období** sestupně, ne dle celkového součtu.

## Zdrojová data (sloupce se hledají podle hlavičky, ne podle pořadí)

- **QC Prefix:** `CZ25170_Kontrolný_report_-_Prefix.xlsm`, list `Report`, hlavička "Dátum kontroly"
  - datum, Linka, Variant, VYKONANÝCH kontrol (checked), Chyba, detekovaných vad, POSÚDENIE
  - Forward-fill datum/linka/varianta; checked je **jen per (datum, linka)**, ne per varianta
  - L1 dělá LH i RH (převážně RH), L2 jen LH
- **QC MC:** `CZ26027_Kontrolný_report_MC_Prefix.xlsm`, list `Report`, bez sloupce Linka
  - checked **per (datum, varianta)**, Posúdenie, NOK po posúdení, OK = checked − NOK
- **Posouzení:** `ArchivPosouzeni_MainCarrier.xlsx`, listy `Posouzení PREFIX` / `Posouzení SKLAD`
  (řádek "Kód vady" + popis, každý vyplněný PN = 1 MC), `Sklad - na rework`
  - Varianta z rodiny PN: MY0547099=HEAT. FRT RH, MY0547078=HEAT. FRT LH, 3448362=FRT RH,
    3448356=FRT LH, 3449523=RR RH, 3449518=RR LH (prefix "M" se ignoruje)
  - Listy `Pareto PREFIX` / `Pareto SKLAD` jsou vzor pro záložku Posouzení (filtr období, pořadí,
    % podíl, kumulativní %). POZOR: jejich vzorce berou jen řádky 6:205 (data do ~16./24. 7. 2026)
    a seznam 35 kódů bez sloupců PSPS, PLPK2, PELC2, PDEP2… → Excel CELKEM 542/558 vs. skutečných
    953/1045 (stav 7. 9. 2026). Dashboard počítá všechny řádky a všechny sloupce.
  - List SKLAD má kód PSNA dvakrát (nástřih / zaříznutí) → zaříznutí se mapuje na PSZA jako v PREFIX.
- **Scrap:** `scrap_QAD_*.xlsx`, list `Data QAD`, hlavičky `Transaction Number`, `Transaction Type`,
  `Date`, `Location`, `Reason`, `Description reason`, `Group 2`, `Excluded?`, `EUR`
  - Filter: Location == 'PCO001', Transaction Type == 'ISS-SCRP', EUR > 0, dedup přes Transaction Number
  - W/O tests = Excluded? = NO a Reason ≠ 20; With tests = Excluded? = NO (viz skill qlr-mesicni-report)
  - Ověřeno na exportu 9/2026 (39 613 řádků, PCO001 2 674, po filtru 2 628; po Excluded?=NO zbývá jen kód 20)
  - Plný export má 20 MB (celý závod) → do repa jen extrakt: `node tools/scrap-extract.js <export> PCO001`
    → `data/scrap_QAD_PCO001.xlsx`. V prohlížeči jde nahrát i plný export.
  - Reason kódy scrapu (SPF, SSP2, PMEP, NRW, PDSP…) = kódy posouzení → záložka Scrap má tabulku
    Posouzení → scrap podle kódu. Varianta ze sloupce Item Number (stejné rodiny PN jako posouzení).

## Vyřešené bugy (ať se nerozbijí — pokryto `test/parser.test.js`)

- Text ve sloupci *Linka* (`"6:00 - 14:00"`) → guard `typeof === 'number'`, řádek si ponechá
  předchozí linku a hlásí se ve "Kontrola kvality dat".
- Rok v budoucnosti (MC report měl 56 řádků s 2028-08-24) → opraví se na aktuální rok, hlásí se.
- `hrana > 1mm` vs `Hrana > 1mm` → sjednocení prvního písmene.

## Známý render fix (hotový, ať to nerozbiješ)

- Osa Y vždy od nuly (SVG grafy: `niceTicks` začíná 0) — dřív natvrdo `min: 15`, ořezávalo křivku.
- Meta viewport: `width=device-width, initial-scale=1` — dřív `width=2560` (fixní).
- Posun cca 600 ms Canvas→SVG fallback už není potřeba, grafy jsou SVG rovnou.

## Otevřené analytické úkoly (nižší priorita)

- Gemba walk L1 pravá strana (tryska robota RH, přípravek) — root cause "Znečistenie od lepidla"
  (vada je jen na RH variantách, LH ~0 %)
- MC report W36 2026: 11 170 vad na 1 639 ks (682/100) — ověřit zadání kontrolovaných ks
- Export do Excelu přímo z panelu
- Domů: dlaždice ukazují poslední den s daty per zdroj; den lze zvolit ručně (S.day). Uživatel chce
  úvodní stranu ČISTOU — žádné seznamy vad v dlaždicích, detail patří pod dlaždice (S.detail).

## Styl práce

- Iterativně, ne velký spec předem. Uživatel chce vidět mezikroky.
- 2–3 varianty s trade-offy, ne jedno řešení.
- Přímé, kopírovatelné výstupy. Bez teoretických úvodů.
