# Sweden Relief STL Generator

GitHub-Pages-Variante des Relief-STL-Generators für Schweden.

## Daten

Die App verwendet **Lantmäteriet – Markhöjdmodell Nedladdning**:

- nationales Geländemodell
- 1 m Raster
- COG (Cloud Optimized GeoTIFF)
- SWEREF 99 TM / RH 2000
- STAC API: `https://api.lantmateriet.se/stac-hojd/v1`
- Lizenz der Höhendaten: **CC BY 4.0**

Der Datenzugriff ist kostenlos, erfordert aber einen Geotorget-Zugang mit Berechtigung für
**Markhöjdmodell Nedladdning**.

## Sicherheit / GitHub Pages

GitHub Pages ist rein statisch. Deshalb enthält dieses Repository **keinen API-Key und kein Passwort**.

Die Zugangsdaten werden beim Start der Seite eingegeben und nur im Arbeitsspeicher der geöffneten
Browserseite gehalten. Sie werden weder in `localStorage` noch in `sessionStorage` geschrieben.

## Verwendung

1. Auf Geotorget einen Zugang erstellen.
2. Berechtigung für **Markhöjdmodell Nedladdning** aktivieren.
3. App öffnen.
4. Benutzername und Passwort/Token eingeben.
5. `Verbindung testen`.
6. Gebiet auf der Karte wählen.
7. Modellgrösse, Auflösung und Überhöhung einstellen.
8. `Relief erzeugen`.
9. STL herunterladen.

## GitHub Pages

Dateien in ein Repository legen:

- `index.html`
- `style.css`
- `app.js`

Dann:

`Settings → Pages → Deploy from a branch → main / root`

## Technische Hinweise

Die App:

- sucht die passende Lantmäteriet-STAC-Collection dynamisch,
- liest nur die benötigten Fenster der COG-Dateien,
- projiziert WGS84 nach SWEREF 99 TM (EPSG:3006),
- unterstützt gedrehte Rechtecke,
- erzeugt ein geschlossenes binäres STL,
- blockiert den Export vollständig, sobald Rasterpunkte fehlen,
- reduziert die interne Rasterauflösung bei extrem grossen Ausschnitten automatisch,
  damit der Browser nicht durch zu grosse Meshes abstürzt.

### Browser / CORS

Der Abruf erfolgt direkt vom Browser zu Lantmäteriets API und Downloadservern.
Falls Lantmäteriet bestimmte CORS-Header oder Authentifizierungsverfahren ändert,
ist bei einer rein statischen GitHub-Pages-App gegebenenfalls ein kleiner Proxy nötig.

## Attribution

Bei Veröffentlichung oder Weitergabe der erzeugten Reliefs sollte die Datenquelle angegeben werden:

> Höhendaten: Lantmäteriet, Markhöjdmodell Nedladdning, CC BY 4.0.

App: Reto Speerli.
