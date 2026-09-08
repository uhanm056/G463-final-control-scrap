# CLAUDE.md — Prefix Dashboards (Yanfeng Planá n.L.)

Kontext pro Claude Code. Přečti si to na začátku každé session a drž se toho.

## Co to je

Interaktivní HTML dashboardy pro linku **G463 Prefix** (door trim panely) v závodě
Yanfeng Planá nad Lužnicí. Dva dashboardy:

1. **Quality** (`dashboard_PREFIX_W28.html`) — QC inspekce, top 5 vad, týdenní/měsíční trend
2. **Scrap** (`dashboard_SCRAP_PCO001.html`) — scrap v EUR, Pareto, location PCO001

Uživatel: Milan, Operations Manager. Komunikace česky.

## Prostředí — TVRDÁ OMEZENÍ

Shopfloor síť a zobrazení na TV kladou omezení, která se NESMÍ porušit:

- **Žádné CDN.** Shopfloor síť blokuje Google Fonts i cdnjs. Chart.js a SheetJS
  musí být **inline v souboru** (npm registry funguje, cdnjs ne).
- **Fonty offline:** Arial (nadpisy/text), Consolas (čísla). Žádný `@import` z Google Fonts.
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

## Zdrojová data

- **QC:** `CZ25170_Kontrolný_report_-_Prefix.xlsm`, list `Report`, data od řádku 7
  - Sloupce: 0=datum, 2=linka, 7=checked, 9=defect, 10=count
  - Forward-fill datum/linka/checked; deduplikace checked přes (datum, linka)
- **Scrap:** `scrap_QAD_*.xlsx`, list `Data QAD`, data od řádku 2
  - Sloupce: 0=Site, 2=Group, 6=Date, 10=Location, 43=Reason, 44=ReasonDesc, 57=EUR
  - Filter: Location == 'PCO001', Transaction == 'ISS-SCRP'
  - Vyloučit testy/tech scrap/PPAP (EXCLUDE_CODES + EXCLUDE_KEYWORDS)
  - `data_only=True` nutné (EUR jsou Excel formule)

## OTEVŘENÝ BUG — vyřešit jako první

`processExcel` (a jeho Python protějšek) **padá při importu**, když je ve sloupci
*linka* místo čísla textová hodnota, konkrétně `"6:00 - 14:00"` (někdo omylem
zapsal směnu). Chyba: `ValueError: invalid literal for int()`.

**Fix:** guard před přetypováním —
- Python: `if isinstance(linka, (int, float)): linka = int(linka)` else skip/zachovej předchozí
- JS: `typeof linka === 'number'` check před `parseInt`

## Známý render fix (hotový, ať to nerozbiješ)

- Y osa: `beginAtZero: true, suggestedMax: 100` — dřív byl natvrdo `min: 15`,
  což ořezávalo křivku pod 15 %.
- Meta viewport: `width=device-width, initial-scale=1` — dřív `width=2560` (fixní).

## Otevřené analytické úkoly (nižší priorita)

- Gemba walk L1 pravá strana (tryska robota RH, přípravek) — root cause "Znečistenie od lepidla"
  (vada je jen na RH variantách, LH ~0 %)
- Aktualizace QC dat o W29+ (blokováno bugem výše)
- Rozdělit HTML na moduly (`index.html` + `app.js` + `parser.js`) — ZVÁŽIT, ne nutně;
  self-contained má pro shopfloor přednost
- Srovnávací pohled měsíc/měsíc, až budou 3+ měsíce dat
- Export do Excelu přímo z panelu

## Styl práce

- Iterativně, ne velký spec předem. Uživatel chce vidět mezikroky.
- 2–3 varianty s trade-offy, ne jedno řešení.
- Přímé, kopírovatelné výstupy. Bez teoretických úvodů.
