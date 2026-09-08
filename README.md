# G463 Prefix — Finální kontrola · Posouzení · Scrap

Self-contained HTML dashboard pro linku G463 Prefix (Yanfeng Planá n.L.). Jeden soubor
`docs/index.html`, bez CDN, bez buildu na cílovém PC — otevře se v Edge/Chrome i z disku
nebo z GitHub Pages / OneDrive.

## Použití

- Otevři `docs/index.html`. Záložky: Denní TV · Přehled · Finální kontrola Prefix (L1/L2 odděleně) ·
  Kontrola MC · Posouzení · Scrap · Data & metodika.
- **Denní TV** = dlaždice per zdroj (L1, L2, MC, posouzení PREFIX/SKLAD, sklad→rework, scrap),
  poslední den s daty vs předchozí den, top 3 a trend 10 dnů. Šipkami/datem lze zvolit jiný den.
- **TV režim**: `index.html#tab=0&tv` — bez lišt, 4 sloupce, hodiny, automatické obnovení
  stránky každých 15 min (nová data z GitHub Pages / OneDrive se načtou samy).
- Přepínač **Týden / Měsíc** a počet zobrazených období platí pro týdenní/měsíční záložky.
- Přímý odkaz na záložku: `index.html#tab=N` (0 = Denní TV, 1 = Přehled, … 6 = Data).
- **Nová data** přetáhni do záložky *Data & metodika* (typ souboru se pozná podle listu):
  - `CZ25170_Kontrolný_report_-_Prefix.xlsm` — finální kontrola Prefix, L1/L2
  - `CZ26027_Kontrolný_report_MC_Prefix.xlsm` — kontrola MC (posouzení, NOK)
  - `ArchivPosouzeni_MainCarrier.xlsx` — posouzení PREFIX/SKLAD + sklad na rework
  - `scrap_QAD_*.xlsx` (list `Data QAD`) — scrap, location PCO001
  Import se ukládá do localStorage daného prohlížeče. Záloha/obnova = JSON.

## Sestavení (jen když chceš data zapéct do souboru)

```
node build.js          # data/*.xls* → docs/index.html
node test/parser.test.js
```

Bez `npm install` — SheetJS je ve `vendor/` a jde inline do HTML.

## Struktura

- `src/parser.js` — jeden parser pro build i prohlížeč (Prefix/MC report, posouzení, rework, QAD scrap)
- `src/charts.js` — SVG grafy (bez Canvas, funguje i na TV bez GPU)
- `src/app.js` — agregace, RAG, záložky, import, localStorage
- `src/styles.css`, `src/template.html`, `build.js`
- `data/` — zdrojové soubory zapečené do sestavení
- `docs/index.html` — výstup (GitHub Pages: Settings → Pages → branch / `docs`)

Metodika (definice ukazatelů, RAG, filtry scrapu) je přímo v aplikaci v záložce *Data & metodika*.
