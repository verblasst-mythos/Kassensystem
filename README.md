# Masora Döner — Kasse

Kassensystem für den Imbiss, komplett in **HTML, CSS und JavaScript** gebaut (kein Build, kein Framework).
Alle Daten liegen dauerhaft in **Supabase** — nichts geht beim Neuladen oder Gerätewechsel verloren.

## Neu in v2

**Kasse**

- Suchfeld (Enter legt den ersten Treffer in den Bon) und Favoriten per Stern
- Rückgängig-Taste nach Entfernen oder Leeren
- Bon parken und später wieder öffnen (inkl. Notiz, Bestellart, Kooperation); beim Abmelden wird ein offener Bon automatisch geparkt
- Bestellart (Hier essen / Mitnehmen) und Notiz je Bon, beides erscheint auf dem Bon
- MwSt. getrennt nach 7 % und 19 % auf dem Bon
- Tastenkürzel: F2 Suche, F4 Bar, F8 Karte, F6 Parken
- Quittung wird an Discord gesendet (Cloudflare Worker, siehe `worker/`), Lager-Warnungen ebenso

**Bestellungen**

- Suche, Zahlart-Filter und CSV-Export (Excel-tauglich)

**Verwaltung**

- Bargeld-Kontrolle im Tagesabschluss: Soll aus dem System gegen gezähltes Bargeld, Differenz live
- Theme (hell/dunkel) und Akzentfarbe einstellbar
- CSV-Export bei den Dienstzeiten

## Funktionen (Basis)

**Anmeldung**

- PIN-Feld mit Zifferntastatur, auch über die Tastatur bedienbar
- Zwei Rollen: `admin` (alles) und `kasse` (Kasse + Bestellungen)

**Stempeluhr**

- Ein- und Ausstempeln direkt in der Kopfzeile, Status immer sichtbar
- Ohne Dienst lässt sich nichts kassieren — es kommt ein Hinweis mit Einstempel-Taste
- Die Kasse meldet sich **60 Minuten nach dem Anmelden** automatisch ab und stempelt dabei aus
- Countdown in der Kopfzeile, Warnung 5 Minuten vorher
- Meldet man sich innerhalb von 15 Minuten wieder an, wird die Schicht fortgesetzt statt neu begonnen

**Kasse**

- Kategorien als Reiter, Produkte als große Touch-Kacheln
- Lagerstand auf jeder Kachel, ausverkaufte Artikel sind gesperrt
- Warenkorb mit Menge +/−, Einzelposten löschen, komplett leeren
- Rabatte (Prozent oder fester Betrag) aus der Datenbank
- Kooperationen: Rabatt nur nach Eingabe des Codeworts
- Barzahlung mit Schnellwahl-Beträgen, automatischem Rückgeld und Sperre bei zu wenig Geld
- Kartenzahlung
- Bon im 40-Zeichen-Format, direkt druckbar

**Bestellungen**

- Filter: Heute / 7 Tage / Alle
- Zusätzlich nach **einzelnen Mitarbeitern** filtern
- Kennzahlen: Umsatz, Anzahl, Ø pro Bon, Bar, Karte
- Tabelle „Umsatz je Mitarbeiter" (nur Admin) mit Anteil am Gesamtumsatz
- Bon erneut drucken
- Storno (nur Admin) — der Bon bleibt gespeichert, zählt nicht mehr im Umsatz und die Artikel gehen zurück ins Lager

**Verwaltung (nur Admin)**

- Produkte anlegen, bearbeiten, löschen, aktiv/inaktiv schalten — inklusive Bestand und Mindestbestand
- **Lager**: Warenwert, Nachbestell-Liste, Wareneingang, Schwund, Korrektur nach Zählung, Bewegungsverlauf
- Rabatte pflegen
- **Kooperationen**: Name, Prozent oder fester Betrag, Codewort, aktiv/inaktiv
- Personal und PINs pflegen
- **Dienstzeiten**: wer war wann im Dienst, Dauer je Schicht, Summe je Mitarbeiter, Zeitraum Heute / 7 / 30 Tage
- Einstellungen: Name, Adresse, Telefon, Steuernummer, MwSt.-Satz, Bon-Fußtext
- Tagesabschluss (Z-Bericht) mit Umsatz, Zahlarten, enthaltener MwSt., Rabatten, Stornos, Umsatz je Mitarbeiter und Artikelstatistik

**Sonstiges**

- Helles und dunkles Design
- Voll bedienbar auf Tablet und Handy

## Struktur

```
index.html        Grundgerüst, Anmeldung, drei Ansichten
css/style.css     Design-System und alle Komponenten
js/db.js          Supabase-Verbindung und Datenzugriff
js/app.js         Zustand, Hilfsfunktionen, Dialoge, Anmeldung, Navigation
js/kasse.js       Kasse, Warenkorb, Zahlung, Bon
js/orders.js      Bestellübersicht, Kennzahlen je Mitarbeiter, Storno
js/admin.js       Verwaltung mit acht Reitern
worker/worker.js  Cloudflare Worker für Discord (Quittung, Lager-Warnung)
favicon.svg       Logo als Symbol
supabase/         SQL-Dateien für die Datenbank
```

## Datenbank-Erweiterung einspielen

Die Datei `supabase/v2-schichten-kooperationen-lager.sql` bringt Schichten, Kooperationen
und das Lager in die Datenbank. Sie muss **einmal** ausgeführt werden:

1. Supabase öffnen → Projekt `ldeuoyzuhgpvhznnfxyo` → **SQL Editor**
2. Inhalt der Datei komplett einfügen und auf **Run** klicken
3. Seite der Kasse neu laden

Die Datei kann ohne Schaden mehrfach ausgeführt werden. Solange sie nicht eingespielt ist,
läuft die Kasse im Notbetrieb weiter: Bestellungen werden gespeichert, aber ohne Lagerabzug,
und die Stempeluhr meldet einen Fehler.

## Datenbank

Supabase-Projekt `ldeuoyzuhgpvhznnfxyo`, Tabellen im Schema `public`:

| Tabelle     | Zweck                                                        |
| ----------- | ------------------------------------------------------------ |
| `products`  | Speisekarte inkl. Kategorie, Preis, Sortierung               |
| `discounts` | Rabatte (`percent` oder `fixed`)                             |
| `staff`     | Mitarbeiter mit PIN und Rolle                                |
| `orders`    | Bestellungen mit Positionen als JSON, Summen, Zahlart, Status |
| `settings`  | Einzelne Zeile mit den Imbiss-Stammdaten                     |

## Wichtiger Hinweis zur Sicherheit

Die App läuft ohne Server und spricht Supabase direkt mit dem öffentlichen Key an.
Damit das funktioniert, erlauben die RLS-Regeln dem `anon`-Zugang Lesen und Schreiben.
Wer die Adresse der Seite kennt, kann also theoretisch auf die Daten zugreifen — auch auf die PINs.

Für den Einsatz im echten Betrieb empfiehlt sich eines davon:

1. Seite nur intern erreichbar machen (privater Link, lokales Netz)
2. Supabase Auth einbauen und die RLS-Regeln auf angemeldete Nutzer einschränken
3. PINs als Hash speichern und die Prüfung in eine Supabase Edge Function verlagern

## Start

Es ist kein Build nötig. Ordner auf einen beliebigen Webserver legen oder lokal starten:

```bash
npx serve . -l 3000
```

## Anmeldedaten

| Name    | PIN  | Rolle |
| ------- | ---- | ----- |
| Chef    | 1234 | Admin |
| Kasse 1 | 1111 | Kasse |

PINs bitte unter Verwaltung → Personal ändern.
