# -*- coding: utf-8 -*-
"""
Erzeugt docs/Reisebuch-Bedienung-und-Betrieb.pdf (Standardlayout: Titelseite, Inhaltsverzeichnis auf EINER Seite, nummerierte
Kapitel, Tabellen und Hinweiskästen). Aufruf:  python3 docs/tools/make_doc.py
Benötigt reportlab (pip install reportlab) und die DejaVu-Schriften (Pfad FD unten).
Version und Datum werden automatisch gesetzt (Datei VERSION, heutiges Datum). Von Hand pflegen: Datenbank-Stand im Kapitel
„Stand und Ausblick“, die Tabelle „Seit der ersten Fassung neu“ und neue Inhalte. Das Inhaltsverzeichnis muss auf eine Seite
passen (sonst die Abstände bei toc.levelStyles / toc.tableStyle straffen).
"""
import datetime
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak, NextPageTemplate,
                                Table, TableStyle, Preformatted, KeepTogether, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents

FD = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('DV', FD + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DV-B', FD + 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DVM', FD + 'DejaVuSansMono.ttf'))
ital = FD + 'DejaVuSans-Oblique.ttf'
pdfmetrics.registerFont(TTFont('DV-I', ital if os.path.exists(ital) else FD + 'DejaVuSans.ttf'))
pdfmetrics.registerFontFamily('DV', normal='DV', bold='DV-B', italic='DV-I', boldItalic='DV-B')

NAVY = colors.HexColor('#14385c')
TEAL = colors.HexColor('#1f7a8c')
GREY = colors.HexColor('#637284')
LIGHT = colors.HexColor('#f1f4f8')
LINE = colors.HexColor('#d5dbe3')

body = ParagraphStyle('body', fontName='DV', fontSize=9.3, leading=13.6, textColor=colors.HexColor('#1a2735'), spaceAfter=5, alignment=TA_LEFT)
small = ParagraphStyle('small', parent=body, fontSize=8.2, leading=11.4, textColor=GREY)
cell = ParagraphStyle('cell', parent=body, fontSize=8.4, leading=11.6, spaceAfter=0)
cellb = ParagraphStyle('cellb', parent=cell, fontName='DV-B', textColor=colors.white)
h1s = ParagraphStyle('h1', fontName='DV-B', fontSize=16, leading=20, textColor=NAVY, spaceBefore=6, spaceAfter=8)
h2s = ParagraphStyle('h2', fontName='DV-B', fontSize=11.2, leading=15, textColor=TEAL, spaceBefore=10, spaceAfter=4)
bullet = ParagraphStyle('bullet', parent=body, leftIndent=14, bulletIndent=3, spaceAfter=2.5)
code = ParagraphStyle('code', fontName='DVM', fontSize=7.9, leading=10.6, textColor=colors.HexColor('#102a43'))
title = ParagraphStyle('title', fontName='DV-B', fontSize=34, leading=40, textColor=NAVY, spaceAfter=6)
subtitle = ParagraphStyle('subtitle', fontName='DV', fontSize=15, leading=21, textColor=TEAL, spaceAfter=18)
meta = ParagraphStyle('meta', fontName='DV', fontSize=10, leading=15, textColor=GREY)

class Heading(Paragraph):
    def __init__(self, text, style, level):
        super().__init__(text, style)
        self.level = level
        self.plain = text

class Doc(BaseDocTemplate):
    def afterFlowable(self, f):
        if isinstance(f, Heading):
            key = 'h%d-%d' % (f.level, id(f))
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.plain, key, level=f.level, closed=False)
            self.notify('TOCEntry', (f.level, f.plain, self.page, key))

n1 = [0]; n2 = [0]
def H1(t, newpage=True):
    n1[0] += 1; n2[0] = 0
    out = []
    if newpage: out.append(CondPageBreak(7 * cm))
    out.append(Heading('%d&nbsp;&nbsp;%s' % (n1[0], t), h1s, 0))
    return out
def H2(t):
    n2[0] += 1
    return [CondPageBreak(3.5 * cm), Heading('%d.%d&nbsp;&nbsp;%s' % (n1[0], n2[0], t), h2s, 1)]
def P(t): return Paragraph(t, body)
def B(items): return [Paragraph(i, bullet, bulletText='•') for i in items]
def N(items): return [Paragraph(i, bullet, bulletText='%d.' % (k + 1)) for k, i in enumerate(items)]
def CODE(t):
    box = Table([[Preformatted(t, code)]], colWidths=[16.0 * cm])
    box.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), LIGHT), ('BOX', (0, 0), (-1, -1), 0.5, LINE),
                             ('LEFTPADDING', (0, 0), (-1, -1), 8), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    return [box, Spacer(1, 6)]
def CALL(kind, t):
    c = {'Wichtig': colors.HexColor('#c0392b'), 'Hinweis': TEAL, 'Tipp': colors.HexColor('#2e8b57')}[kind]
    box = Table([[Paragraph('<b>%s:</b> %s' % (kind, t), cell)]], colWidths=[16.0 * cm])
    box.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), LIGHT), ('LINEBEFORE', (0, 0), (0, -1), 3, c),
                             ('LEFTPADDING', (0, 0), (-1, -1), 9), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    return [box, Spacer(1, 7)]
def TBL(rows, widths, head=True):
    data = []
    for i, r in enumerate(rows):
        data.append([Paragraph(str(c), cellb if (head and i == 0) else cell) for c in r])
    t = Table(data, colWidths=[w * cm for w in widths], repeatRows=1 if head else 0)
    st = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('GRID', (0, 0), (-1, -1), 0.4, LINE),
          ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]
    if head: st += [('BACKGROUND', (0, 0), (-1, 0), NAVY)]
    for i in range(1 if head else 0, len(rows)):
        if (i % 2) == 0: st.append(('BACKGROUND', (0, i), (-1, i), LIGHT))
    t.setStyle(TableStyle(st))
    return [t, Spacer(1, 8)]

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
VERSION = open(os.path.join(REPO, 'VERSION')).read().strip()
STAND = datetime.date.today().strftime('%d.%m.%Y')
def cover(canv, doc):
    canv.saveState()
    canv.setFillColor(NAVY); canv.rect(0, A4[1] - 1.1 * cm, A4[0], 1.1 * cm, stroke=0, fill=1)
    canv.setFillColor(TEAL); canv.rect(0, A4[1] - 1.45 * cm, A4[0], 0.35 * cm, stroke=0, fill=1)
    canv.restoreState()
def page(canv, doc):
    canv.saveState()
    canv.setStrokeColor(LINE); canv.setLineWidth(0.5)
    canv.line(2.2 * cm, A4[1] - 1.7 * cm, A4[0] - 2.2 * cm, A4[1] - 1.7 * cm)
    canv.line(2.2 * cm, 1.7 * cm, A4[0] - 2.2 * cm, 1.7 * cm)
    canv.setFont('DV', 7.8); canv.setFillColor(GREY)
    canv.drawString(2.2 * cm, A4[1] - 1.4 * cm, 'Reisebuch · Bedienung und Betrieb')
    canv.drawString(2.2 * cm, 1.15 * cm, 'Stand %s · Version %s' % (STAND, VERSION))
    canv.drawRightString(A4[0] - 2.2 * cm, 1.15 * cm, 'Seite %d' % doc.page)
    canv.restoreState()

OUT = os.path.join(REPO, 'docs', 'Reisebuch-Bedienung-und-Betrieb.pdf')
doc = Doc(OUT, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm, topMargin=2.3 * cm, bottomMargin=2.2 * cm,
          title='Reisebuch – Bedienung und Betrieb', author='Reisebuch', subject='Bedienung und Betrieb')
fw, fh = A4[0] - 4.4 * cm, A4[1] - 4.5 * cm
doc.addPageTemplates([
    PageTemplate(id='Cover', frames=[Frame(2.2 * cm, 2.2 * cm, fw, A4[1] - 4.4 * cm, id='c')], onPage=cover),
    PageTemplate(id='Body', frames=[Frame(2.2 * cm, 2.2 * cm, fw, fh, id='b')], onPage=page),
])

toc = TableOfContents()
toc.dotsMinLevel = 0
toc.tableStyle = TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('RIGHTPADDING', (0, 0), (-1, -1), 0), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0.6)])
toc.levelStyles = [
    ParagraphStyle('t0', fontName='DV-B', fontSize=9.0, leading=11.0, leftIndent=0, spaceBefore=1.5, textColor=NAVY),
    ParagraphStyle('t1', fontName='DV', fontSize=8.1, leading=9.3, leftIndent=16, textColor=colors.HexColor('#1a2735')),
]

S = []
# ---------------- Titelseite ----------------
S += [Spacer(1, 6.5 * cm), Paragraph('Reisebuch', title),
      Paragraph('Bedienung und Betrieb', subtitle),
      Paragraph('Reiseplaner für die Familie: Kreuzfahrten, Städtetrips und Rundreisen,<br/>selbst betrieben auf der Synology', meta), Spacer(1, 1.2 * cm),
      Paragraph('Stand: %s<br/>App-Version: %s<br/>Quellcode: github.com/theoldphilip/bordbuch (privat)' % (STAND, VERSION), meta),
      NextPageTemplate('Body'), PageBreak()]
S += [Paragraph('Inhaltsverzeichnis', h1s), Spacer(1, 4), toc, PageBreak()]

# ---------------- 1 Überblick ----------------
S += H1('Überblick', newpage=False)
S += H2('Was Reisebuch ist')
S += [P('Reisebuch ist ein Reiseplaner für die Familie. Es kennt drei Reisearten: <b>Kreuzfahrt</b> (mit An- und Abreise), <b>Städtetrip / Urlaub</b> und <b>Rundreise</b> mit mehreren Stationen. Er läuft als ein Docker-Container auf der Synology '
        'und ist nur im Heimnetz oder über das VPN (WireGuard) erreichbar. Die Bedienung erfolgt im Browser; auf dem iPhone liegt Reisebuch als App auf dem Home-Bildschirm. Das Logo ist ein Kompass.')]
S += B(['Der Ablauf einer Kreuzfahrt gliedert sich automatisch in <b>Anreise, Kreuzfahrt und Abreise</b>; bei Rundreisen gibt es <b>Stationen</b>.',
        'Ein <b>Puffer-Check</b> warnt, wenn Zeiten zu knapp sind oder etwas fehlt (Anreise zum Schiff, Ausflüge, Hotel, Rückreise, Unterkunft und Verbindung zwischen Stationen).',
        'Dokumente (Buchungen, Tickets, Screenshots, Text) ordnet eine <b>KI</b> den Reisepunkten zu. Du bestätigst jeden Vorschlag. Optional recherchiert die KI Lücken im Internet (z. B. den Reiseverlauf) und prüft die ganze Reise (Knopf „Prüfen“).',
        '<b>Erinnerungen</b> aufs iPhone nach Uhrzeit, mit deinem persönlichen Zeitbedarf als Vorlauf.'])
S += H2('Bestandteile')
S += TBL([['Baustein', 'Ort', 'Aufgabe'],
          ['Server (Container „bordbuch“)', 'Synology, Ordner /volume1/docker/bordbuch', 'Logik, Datenbank, Dokumente, KI-Anbindung, Erinnerungen'],
          ['Web-App', 'Safari / Home-Bildschirm-App', 'Bedienung auf iPhone und Computer'],
          ['Reverse-Proxy', 'DSM', 'HTTPS auf Port 8444 für die Web-App'],
          ['Datenordner „data“', 'neben der docker-compose.yml', 'Datenbank, Uploads, Backups, Zertifikat'],
          ['Quellcode', 'GitHub (privat)', 'Versionen und Updates']], [4.3, 5.4, 6.3])
S += H2('Adressen und Zugang')
S += TBL([['Adresse', 'Zweck'],
          ['http://172.16.10.1:8080', 'Zugang im VPN ohne Verschlüsselung. Dient der Einrichtung, z. B. zum Herunterladen des Zertifikats.'],
          ['https://172.16.10.1:8444', 'Die normale Adresse. Nötig für Erinnerungen, das Teilen-Menü und das Zwischenablage-Einfügen.']], [5.2, 10.8])
S += CALL('Wichtig', 'Reisebuch soll nicht aus dem Internet erreichbar sein. Der Router darf die Ports 8080 und 8444 nicht freigeben. Der Zugang läuft ausschließlich über das VPN.')
S += H2('Konten und Rollen')
S += B(['<b>Admin:</b> verwaltet Familie, KI-Verbindung und Zertifikat. Das erste Konto, das angelegt wird, ist Admin.',
        '<b>Pro Reise</b> gibt es drei Rollen: <b>Besitzer</b> (alles, auch löschen und teilen), <b>Bearbeiten</b> und <b>Nur ansehen</b>.'])

# ---------------- 2 Gerät einrichten ----------------
S += H1('iPhone einrichten')
S += H2('Erste Anmeldung')
S += [P('Rufe im VPN die Adresse auf und melde dich mit deinem Konto an. Direkt danach erscheint einmal der Dialog <b>„Dieses Gerät einrichten“</b> mit den offenen Schritten. '
        'Du findest ihn jederzeit unter <i>Einstellungen → Dieses Gerät einrichten</i>; ein Abzeichen zeigt die Zahl der offenen Schritte.')]
S += CALL('Wichtig', 'Beim allerersten Aufruf einer neuen Installation legt die Person, die zuerst kommt, das Admin-Konto an. Mache das sofort selbst.')
S += H2('Schritt 1: Zertifikat installieren')
S += [P('Damit das iPhone der sicheren Adresse vertraut, installierst du einmal pro Gerät das Zertifikat.')]
S += N(['Öffne in <b>Safari</b> (nicht in der Home-Bildschirm-App) die http-Adresse und melde dich an.',
        '<i>Einstellungen → Dieses Gerät einrichten → Zertifikat herunterladen</i> und den Download erlauben.',
        'iPhone: <i>Einstellungen → Profil geladen → Installieren</i>.',
        'iPhone: <i>Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen</i>: dem Zertifikat <b>vollständig vertrauen</b>.'])
S += H2('Schritt 2: Zum Home-Bildschirm hinzufügen')
S += N(['Öffne Reisebuch in Safari über die <b>HTTPS-Adresse</b> (https://172.16.10.1:8444). Es darf keine Warnung erscheinen.',
        '<i>Teilen → Zum Home-Bildschirm</i>. Der Name „Reisebuch“ und das Kompass-Logo sind voreingestellt.',
        'Öffne Reisebuch ab jetzt über diese Kachel.'])
S += CALL('Wichtig', 'Eine Kachel, die vor der Umbenennung angelegt wurde, heißt weiter „Bordbuch“ und zeigt das Schiff. Name und Symbol liest iOS nur beim Anlegen: Kachel entfernen und neu anlegen. Erinnerungen danach neu aktivieren.')
S += CALL('Hinweis', 'Zeigt die Kachel nur einen Buchstaben oder ein Seitenbild, löschst du sie (lange drücken, App entfernen) und legst sie über die HTTPS-Adresse neu an. iOS liest das Symbol nur beim Anlegen.')
S += H2('Schritt 3: Erinnerungen einschalten')
S += [P('Von der Home-Bildschirm-Kachel aus: <i>Einstellungen → Erinnerungen → Auf diesem Gerät aktivieren</i>, Mitteilungen erlauben, dann <b>Testnachricht senden</b>.')]
S += TBL([['Voraussetzung', 'Warum'],
          ['iOS 16.4 oder neuer', 'Erst ab dieser Version erlaubt iOS Web-Benachrichtigungen.'],
          ['App auf dem Home-Bildschirm', 'In Safari selbst gibt es keine Web-Benachrichtigungen.'],
          ['HTTPS-Adresse mit vertrautem Zertifikat', 'iOS erlaubt Benachrichtigungen nur auf sicheren Seiten.'],
          ['Syno hat ausgehend Internet (Port 443)', 'Die Syno sendet die Nachricht an den Push-Dienst von Apple.']], [6.0, 10.0])

# ---------------- 3 Reisen planen ----------------
S += H1('Reisen planen')
S += H2('Reisearten')
S += [P('Beim Anlegen einer Reise wählst du die Art. Im KI-Modus gibt es zusätzlich <b>Automatisch erkennen</b>: Aus den Dokumenten ergibt sich, ob es eine Kreuzfahrt (sobald eine angelegt wird) oder eine Rundreise (ab zwei Stationen) ist. Die Art lässt sich unter <i>Bearbeiten</i> ändern.')]
S += TBL([['Art', 'Was die App zeigt'],
          ['Kreuzfahrt', 'Anreise, Kreuzfahrt (Hafentage, Ausflüge), Abreise; Reiter „Kreuzfahrt“; Landausflüge'],
          ['Städtetrip / Urlaub', 'Ein Abschnitt „Reiseverlauf“ mit Flug, Unterkunft, Mietwagen, Aktivitäten, Restaurants'],
          ['Rundreise', 'Wie Städtetrip, zusätzlich Stationen (Ort mit Aufenthalt von-bis) mit Prüfung auf Unterkunft und Verbindung']], [4.0, 12.0])
S += [P('Der Reiter „Kreuzfahrt“ und der Eintragstyp „Landausflug“ erscheinen nur bei Kreuzfahrten. Wird in einer anderen Reise eine Kreuzfahrt angelegt, wird sie automatisch zur Kreuzfahrt-Reise. Bestehende Reisen bleiben Kreuzfahrten.')]
S += H2('Aufbau einer Kreuzfahrt-Reise')
S += [P('Der Ablauf teilt sich selbst in Abschnitte. Welcher Eintrag wohin gehört, ergibt sich aus den Zeiten.')]
S += TBL([['Abschnitt', 'Inhalt'],
          ['Anreise', 'Flug, Zug, Parkplatz, Übernachtung vor der Abfahrt, Transfer zum Hafen'],
          ['Kreuzfahrt', 'Einschiffung, Hafentage, Seetage, Ausschiffung, Landausflüge'],
          ['Zwischenprogramm', 'Nur bei zwei Kreuzfahrten hintereinander'],
          ['Abreise', 'Transfer, Übernachtung nach der Ausschiffung, Rückflug, Parkplatz abholen']], [4.0, 12.0])
S += [P('Eintragsarten: Flug, Zug, Bus, Fähre, Transfer (mit Art, z. B. Taxi oder Shuttle), Übernachtung, Parkplatz (Einfahrt, Ausfahrt, Kennzeichen, Shuttle), Mietwagen, '
        'Station (Rundreise), Landausflug, Aktivität, Restaurant und Notiz. Hotel, Parkplatz und Mietwagen erscheinen am Abreisetag ein zweites Mal als Check-out, Ausfahrt oder Rückgabe.')]
S += H2('Kreuzfahrt und Route')
S += [P('Jeder Tag der Route ist eine Einschiffung, ein Hafentag, ein Seetag oder eine Ausschiffung. Pro Tag gibt es <b>Ankunft, Abfahrt, „Alle an Bord“</b>, '
        'die Angabe Tenderhafen und die Zeitzone des Hafens. Beim Anlegen genügt Start- und Enddatum, die Tage dazwischen entstehen als Seetage.')]
S += [P('<b>Jetzt-Markierung:</b> Während der Reise sind vergangene Einträge im Ablauf ausgegraut, und auf der Linie links zeigt eine rosa Markierung „Jetzt“ mit Uhrzeit, wo ihr gerade seid. Sie wandert jede Minute weiter. Vor und nach der Reise gibt es keine Markierung.')]
S += [P('<b>Ansichtsmodus:</b> Sobald der erste Punkt der Reise begonnen hat, sind für Bearbeiter alle Änderungen gesperrt, damit nichts aus Versehen verstellt wird (Schloss am Knopf „Bearbeiten“ und am „+“). Einträge und Hafentage lassen sich weiter öffnen, mit allen Nummern und Anrufen-Knopf. Wer etwas ändern will, tippt auf „Verlassen“ oder „Ändern …“, bekommt eine Warnung und verlässt den Ansichtsmodus bewusst. Er gilt bis zum Schließen der App, danach ist wieder alles geschützt. <b>Prüfen</b> und <b>Quittieren</b> funktionieren immer.')]
S += [P('<b>Gate, Schalter, Kofferband, Gleis:</b> Beim Flug gibt es die Felder Terminal, <b>Check-in-Schalter</b>, <b>Gate</b> und <b>Kofferband</b> (bei Ankunft), beim Zug das <b>Gleis</b>, beim Mietwagen den <b>Schalter</b>. Was bekannt ist, steht fett am Eintrag im Ablauf, zum Beispiel „Terminal 1 · Schalter 31–40 · Gate A12 · Kofferband 4“. Das Gate ist oft erst kurz vorher bekannt, dann trägst du es einfach nach. Die KI liest diese Angaben nur, wenn sie im Dokument stehen. <b>Kabine:</b> Die Kabinennummer steht im Ablauf direkt unter dem Titel der Kreuzfahrt und im Reiter „Kreuzfahrt“.')]
S += H2('Zusatzinfos an jedem Reisepunkt')
S += [P('Einträge, Hafentage und die Kreuzfahrt haben eine Liste mit Zusatzinfos: <b>Telefon, Notruf, E-Mail, Link, Hinweis</b>. Nummern haben einen Anrufen-Knopf. '
        'Im Ablauf zeigt ein Symbol (☎ oder SOS) am Eintrag, dass Infos vorhanden sind.')]
S += CALL('Wichtig', 'Notrufnummern, die die KI aus ihrem allgemeinen Wissen ergänzt (z. B. die Landesnummer), sind gelb als „KI-Wissen, bitte prüfen“ gekennzeichnet. Prüfe sie, bevor du dich darauf verlässt. Nummern aus deinen Dokumenten sind als „aus deinem Dokument“ markiert.')
S += H2('Puffer-Check')
S += [P('Der Puffer-Check steht oben im Ablauf und meldet kritische, knappe und informative Punkte. Mindestzeiten (normal):')]
S += TBL([['Situation', 'Empfohlene Mindestzeit'],
          ['Anreise zum Schiff (Flug / anderes Verkehrsmittel)', '4 h / 2 h vor „Alle an Bord“'],
          ['Ausschiffung bis Abreise (Flug / anderes)', '3 h / 1 h nach dem frühestmöglichen Von-Bord-Gehen (ab 06:00 oder 30 min nach Ankunft des Schiffs, bei eigener Abreise)'],
          ['Rückkehr von einem Landausflug', '30 min vor „Alle an Bord“; privat gebucht 60 min; Tenderhafen +30 min'],
          ['Hotel-Check-out am Einschiffungstag', '2 h vor „Alle an Bord“'],
          ['Parkplatz', 'Muss bis zum Ende der Rückreise gebucht sein']], [8.0, 8.0])
S += [P('<b>Von Bord bis:</b> Bei eigener Abreise kannst du ab etwa 06:00 von Bord. Die App rechnet deshalb vom frühestmöglichen Von-Bord-Gehen, nicht von der Zeit „Von Bord bis“. Diese trägst du nur ein, wenn die Abreise über die Reederei läuft und du einen Ausschiffungs-Slot bekommst. '
        '<b>Hotel-Check-out und Schiff:</b> Der Hinweis auf Wartezeit zwischen Check-out und Check-in am Schiff erscheint nur, wenn vor der Öffnung kein Flug, Zug, Bus oder keine Fähre startet.')]
S += [P('<b>Hinweise quittieren:</b> Jeder Hinweis hat den Knopf <b>quittieren</b> („gesehen, ist in Ordnung“). Quittierte Hinweise verschwinden aus der Zählung und stehen gruppiert unter „Quittiert“ (mit Name und Zeit, <b>zurücknehmen</b> möglich). Das gilt für alle Mitglieder der Reise. Ändert sich die Lage, etwa weil du eine Zeit änderst, kommt der Hinweis von selbst zurück.')]
S += H2('Stationen und ihre Prüfung')
S += [P('Eine Station ist ein Ort mit Ankunft und Abreise (Zeitzone, Land, Zusatzinfos wie bei jedem Eintrag). Sie erscheint im Ablauf mit beiden Terminen. Der Puffer-Check meldet:')]
S += TBL([['Meldung', 'Stufe', 'Bedeutung'],
          ['Keine Unterkunft', 'Warnung', 'Für Nächte einer Station ist weder ein Hotel noch eine Kreuzfahrt eingetragen, z. B. „für 3 Nächte (12.05.–14.05.)“'],
          ['Keine Verbindung', 'Hinweis', 'Zwischen zwei Stationen fehlt ein Flug, Zug, Bus, Transfer, eine Fähre oder ein Mietwagen'],
          ['Überschneidung', 'Warnung', 'Zwei Stationen überlappen sich um mehr als 12 Stunden']], [4.0, 2.4, 9.6])
S += H2('Selbst ändern und aufräumen')
S += [P('Alles lässt sich jederzeit von Hand anlegen, ändern und löschen: Einträge, die Kreuzfahrt, einzelne Reisetage. Mit <b>Leeren</b> im Kopf von Anreise, Abreise oder Zwischenprogramm '
        'löschst du alle Einträge dieses Abschnitts auf einmal (mit Rückfrage; mehrtägige Einträge wie ein Parkplatz verschwinden auch im anderen Abschnitt).')]

# ---------------- 4 KI ----------------
S += H1('Dokumente mit KI zuordnen')
S += H2('Ablauf')
S += N(['<i>Dokumente → Mit KI zuordnen</i> öffnen. Dateien wählen, hineinziehen, Screenshots mit Strg+V einfügen oder Text einfügen.',
        'Die KI liest die Unterlagen (pro Unterlage bis zu etwa einer Minute) und erkennt Flug, Hotel, Parkplatz, Transfer, Ausflug oder die Route einer Kreuzfahrt.',
        'Im Prüfbildschirm wählst du pro Vorschlag <b>Neu anlegen</b>, <b>Aktualisieren</b>, <b>Überspringen</b> oder <b>Bearbeiten</b>.',
        'Erst mit <b>Übernehmen</b> wird gespeichert. Das Dokument hängt danach am Eintrag.'])
S += [P('Gehört ein Dokument zu einer Buchung, die schon eingetragen ist (gleiche Buchungsnummer, Flugnummer oder ähnlicher Titel am gleichen Tag), schlägt die App ein <b>Update</b> vor '
        'und zeigt, was sich ändern würde. So entstehen keine doppelten Einträge.')]
S += H2('Mehrere Dokumente, Screenshots und Text')
S += B(['<b>Mehrere Dateien</b> werden nacheinander geprüft („Dokument 1 von 3“), die Kreuzfahrt zuerst.',
        '<b>Alle zusammen als eine Unterlage auswerten:</b> für mehrere Screenshots derselben Buchungsseite.',
        '<b>Text:</b> beliebig lang (bis etwa 500 000 Zeichen), z. B. eine ganze E-Mail. Er wird als Textdatei abgelegt.',
        '<b>iPhone:</b> der Knopf „Aus Zwischenablage einfügen“ (nur über HTTPS) liest Bilder, PDF und Text direkt; Fotos alternativ über die Fotomediathek.'])
S += H2('Reise direkt aus Dokumenten starten')
S += [P('<i>Reisen → Neue Reise → Mit KI aus Dokumenten</i>: Buchung der Kreuzfahrt plus Flüge, Hotel, Parkplatz und Ausflüge auswählen. Die KI schlägt den Reisenamen vor und baut die Reise auf. '
        'In der Route kannst du Schiff, Kabine und einzelne Tage vor dem Speichern ändern oder entfernen. Landausflüge werden automatisch dem Hafentag ihres Datums zugeordnet.')]
S += H2('Was gelesen wird')
S += TBL([['Art', 'Lesbar', 'Grenze'],
          ['PDF', 'Ja', 'bis 20 MB'],
          ['Fotos (JPG, PNG, WebP, GIF), Screenshots', 'Ja', 'bis 5 MB'],
          ['E-Mail, Text, HTML', 'Ja', 'etwa 500 000 Zeichen'],
          ['Word, Pages, HEIC-Fotos, Wallet-Dateien', 'Nein, nur abgelegt', 'Als PDF speichern oder Text kopieren']], [7.0, 3.6, 5.4])
S += H2('Recherche im Internet (optional)')
S += [P('Im Prüfbildschirm eines Dokuments steht der Kasten <b>Recherche im Internet</b>. Er startet nur auf Tipp und läuft im Hintergrund (ein bis zwei Minuten).')]
S += B(['<b>Reiseverlauf recherchieren</b> (nur bei Kreuzfahrten): sucht die Route mit Datum, Hafen, An- und Abfahrt. Vorhandene Tage aus dem Dokument bleiben, die Recherche füllt Lücken und legt fehlende Tage an.',
        '<b>Lücken recherchieren:</b> Verbindungen und Fahrzeiten, Check-in-Zeiten, Telefonnummern.',
        '<b>Link zur Reise (optional):</b> die KI liest genau diese Seite. Das ist zuverlässiger als freies Suchen.',
        'Die Funde erscheinen <b>mit Quelle zur Auswahl</b>. Nur gefundene Quellen zählen, nur Lücken werden gefüllt, nichts wird ohne „Ausgewählte übernehmen“ und danach „Übernehmen“ gespeichert.',
        '<b>Was wurde gesucht?</b> zeigt Suchanfragen, gelesene Seiten und verworfene Funde. Bei „nichts gefunden“ ist es automatisch geöffnet; ein Link zur Reise hilft dann meist.'])
S += H2('Reise prüfen')
S += [P('Der Knopf <b>„Prüfen“</b> (mit Lupe) oben in einer Reise lässt die KI die ganze Reise auf Lücken und Widersprüche ansehen (fehlende Rückreise, kein Transfer zum Hafen, Hotelnächte, Einträge außerhalb der Reise). '
        'Das Ergebnis ist eine Liste aus Fehlern, Warnungen und Hinweisen mit Vorschlag und Sprung zu den betroffenen Einträgen. Die Prüfung ändert nichts. Wird die Reise danach geändert, steht „veraltet“ dabei; <b>Neu prüfen</b> aktualisiert sie. '
        'Mitglieder mit „Nur ansehen“ sehen das Ergebnis, starten dürfen nur Bearbeiter.')]
S += CALL('Hinweis', 'Die KI-Einschätzungen können falsch liegen. Sie ersetzen weder Blick auf die Buchungen noch den Puffer-Check, sondern ergänzen ihn.')
S += H2('Mehrere Dokumente zusammen oder einzeln?')
S += [P('Die Option <b>Alle zusammen als eine Unterlage auswerten</b> ist nur für Dateien derselben Buchung gedacht (z. B. mehrere Screenshots einer Seite). Verschiedene Buchungen werden einzeln gelesen und nacheinander geprüft. <b>Allgemeine Dokumente</b> wie das Bord-ABC der Reederei (für mehrere Schiffe, ohne Buchung) liest die KI so, dass nur die Nummern und Hinweise <b>deines Schiffs</b> als Zusatzinfos an die Kreuzfahrt kommen, Tagesinfos wie „Verspätete Anreise“ an den Einschiffungstag. Neue Tage oder Einträge entstehen dabei nicht. Die Reihenfolge spielt keine Rolle: Ausflüge werden auch dann dem richtigen Hafentag zugeordnet, wenn die Kreuzfahrt erst später kommt.')]
S += H2('Datenschutz, Modell und Kosten')
S += B(['Beim Analysieren wird der <b>Inhalt der Unterlage</b> (inklusive Namen und Buchungsnummern) über das Internet an <b>Anthropic</b> (Claude-API) gesendet. Ohne API-Schlüssel ist die Funktion aus.',
        '<b>Recherche:</b> Orte, Schiff und Reisedaten aus der Analyse (und ein angegebener Link) gehen an die Websuche von Anthropic, nicht das Dokument. <b>Reise prüfen:</b> Titel, Zeiten, Orte, Anbieter und kurze Notizen, aber keine Buchungsnummern, Preise, Telefonnummern oder Dokumente.',
        'Alles, was die KI liefert, wird vom Server wie eine normale Eingabe geprüft und nur mit deiner Bestätigung gespeichert. Text im Dokument gilt als Daten, nicht als Anweisung.',
        'Standardmodell ist <b>claude-opus-5-5</b> (am genauesten). Günstiger sind claude-sonnet-5-5 und claude-haiku-5-5 (Einstellung AI_MODEL).',
        'Pro Unterlage fallen nach Schätzung einige Cent an; Recherche (Websuche) und „Reise prüfen“ kosten zusätzlich. Ein Ausgabenlimit setzt du in der Anthropic-Console.'])

# ---------------- 5 Zeit + Erinnerungen ----------------
S += H1('Zeitbedarf und Erinnerungen')
S += H2('Persönlicher Zeitbedarf')
S += [P('Unter <i>Einstellungen → Zeitbedarf</i> stellst du ein, ob und wie stark dein eigenes Tempo berücksichtigt wird: ein <b>Faktor</b> (× 1,25 bis × 3) und eine optionale <b>pauschale Zusatzzeit</b>. '
        'Alle Mindestzeiten des Puffer-Checks werden damit gerechnet und auf 5 Minuten aufgerundet. Die Meldungen zeigen <b>immer beide Zeiten</b>: „30 min normal, 45 min persönlich“. '
        'Reicht eine Zeit normal, aber nicht mit deinem Zeitbedarf, steht „nur persönlich“ dabei.')]
S += [P('Die Einstellung gilt nur für dein Konto. In der Datenbank steht nur der Faktor, kein Grund dafür, und nichts davon geht an die KI.')]
S += H2('Erinnerungen nach Uhrzeit')
S += TBL([['Erinnerung', 'Standard-Vorlauf', 'Beispiel'],
          ['Alle an Bord', '60 min', '„Alle an Bord in 1 h 30 min“'],
          ['Ausflug beginnt', '45 min', 'mit Treffpunkt'],
          ['Abfahrt (Bahn, Bus, Fähre, Transfer)', '90 min', 'Abfahrt um …'],
          ['Abflug', '3 h', 'Abflug um …']], [6.5, 3.5, 6.0])
S += B(['<b>Gate geändert:</b> Trägt jemand aus der Reise Gate, Schalter, Kofferband oder Gleis ein oder ändert es (bis 36 Stunden vor und 8 Stunden nach dem Termin), bekommen die anderen eine Nachricht, z. B. „Gate B12 (vorher B14)“. Wer das nicht möchte, schaltet es unter Erinnerungen ab.',
        'Die Abflug-Erinnerung nennt Terminal, Schalter und Gate, wenn sie bekannt sind.',
        'Jeder Vorlauf ist einstellbar. Der <b>persönliche Zeitbedarf verlängert ihn</b> automatisch; die Nachricht nennt beide Zeiten.',
        'Der Server prüft alle 30 Sekunden und sendet jede Erinnerung <b>einmal</b>. Was er um mehr als 5 Minuten verpasst hat, wird nicht verspätet gesendet.',
        'Erinnerungen nach <b>Standort</b> im Hintergrund sind mit einer Web-App nicht möglich. Dafür ist die geplante iOS-App nötig.'])

# ---------------- 6 Familie ----------------
S += H1('Familie und Teilen')
S += H2('Familienmitglied einladen')
S += N(['<i>Einstellungen → Familie</i>, Benutzername und Anzeigename eintragen, mit <b>Vorschlagen</b> ein leicht abzutippendes Startpasswort erzeugen, <b>anlegen</b>.',
        'Es erscheint eine fertige Einladung mit Adresse, Benutzername, Startpasswort und den ersten Schritten.',
        'Auf dem iPhone verschickst du sie über <b>Teilen …</b> (Nachrichten, WhatsApp, Mail). Alternativ Nachricht, E-Mail oder Kopieren.',
        'Das Passwort kannst du aus der Nachricht weglassen und getrennt schicken. Adresse und Text sind vor dem Senden änderbar.'])
S += CALL('Hinweis', 'Das Teilen-Menü gibt es nur über die HTTPS-Adresse. Die Person sollte das Startpasswort nach der ersten Anmeldung unter Einstellungen → Konto ändern. Die App erzwingt das nicht.')
S += H2('Reise teilen')
S += TBL([['Rolle', 'Darf'],
          ['Besitzer', 'Alles, auch Reise löschen und Mitreisende verwalten'],
          ['Bearbeiten', 'Einträge, Kreuzfahrt, Dokumente ändern und hinzufügen'],
          ['Nur ansehen', 'Alles lesen, auch Dokumente und Zusatzinfos']], [4.0, 12.0])
S += [P('Teilen: in der Reise der Reiter <i>Teilen</i>, Familienmitglied und Rolle wählen. Ein Mitreisender kann die Reise selbst verlassen.')]
S += H2('Passwort zurücksetzen und Konto löschen')
S += B(['<i>Einstellungen → Familie → Passwort</i> (Admin): neues Passwort, auf Wunsch gleich die Einladung. Alle Geräte der Person werden abgemeldet.',
        'Löschen eines Kontos (Admin): Reisen, die nur dieser Person gehören, gehen an den Admin über.'])

# ---------------- 7 Betrieb ----------------
S += H1('Betrieb auf der Synology')
S += H2('Verbinden per SSH')
S += [P('SSH ist in DSM nur bei Bedarf eingeschaltet (<i>Systemsteuerung → Terminal &amp; SNMP</i>) und danach wieder auszuschalten. Verbinden vom Computer im VPN:')]
S += CODE('ssh -p 22 rootadmin@172.16.10.1')
S += H2('Update einspielen')
S += CODE('cd /volume1/docker/bordbuch && sudo git pull && sudo docker compose up -d --build')
S += [P('<b>git pull</b> holt die neue Version von GitHub (über einen schreibgeschützten Deploy-Key). <b>docker compose up -d --build</b> baut das Image neu und startet den Container. Das dauert ein bis zwei Minuten. '
        'Daten, Konten und die Datei .env bleiben unberührt. Die Datenbank wird beim Start automatisch ergänzt.')]
S += [P('Kontrolle:')]
S += CODE("sudo docker ps --filter name=bordbuch --format 'table {{.Names}}\\t{{.Status}}'\nsudo docker logs --tail 40 bordbuch")
S += [P('<b>Version prüfen:</b> <i>Einstellungen → Über Reisebuch</i> zeigt die Version des Servers, die der App auf diesem Gerät, das Build-Datum und den Datenbank-Stand. Ist die App älter als der Server, steht dort ein Hinweis und ein „!“ in der Einstellungsliste; <b>App neu laden</b> leert den Zwischenspeicher und lädt neu. Auf der Syno zeigt <i>cat VERSION</i> im Projektordner den Stand des Quellcodes.')]
S += [P('Danach Reisebuch neu laden, auf dem iPhone die App einmal schließen und neu öffnen. Heißt der Befehl bei deiner DSM-Version <i>docker-compose</i>, nimm die Schreibweise mit Bindestrich.')]
S += H2('Konfiguration')
S += [P('Geheimes und Einstellungen stehen in der Datei <b>/volume1/docker/bordbuch/.env</b> (nicht in Git, nicht im Image).')]
S += TBL([['Variable', 'Standard', 'Bedeutung'],
          ['ANTHROPIC_API_KEY', 'leer', 'Schlüssel für die KI. Ohne ihn ist die Dokument-Analyse aus.'],
          ['AI_MODEL', 'claude-opus-5-5', 'Modell der Dokument-Analyse'],
          ['PUSH_SUBJECT', 'mailto:bordbuch@example.com', 'Kennung gegenüber den Push-Diensten (nur an Apple gesendet)'],
          ['DEFAULT_TZ', 'Europe/Zurich', 'Zeitzone für Einträge ohne eigene Zeitzone (docker-compose.yml)'],
          ['MAX_UPLOAD_MB', '25', 'Größe je Dokument (docker-compose.yml)'],
          ['BACKUP_KEEP', '14', 'Zahl der Tages-Backups (docker-compose.yml)']], [4.6, 4.6, 6.8])
S += H2('Daten und Backup')
S += TBL([['Pfad', 'Inhalt'],
          ['data/bordbuch.db', 'Datenbank mit allen Reisen, Konten und Einstellungen'],
          ['data/uploads/', 'Hochgeladene Dokumente'],
          ['data/backups/', 'Täglich eine konsistente Kopie der Datenbank, die letzten 14'],
          ['data/certificate.pem', 'Öffentliches Zertifikat für das iPhone (Download in der App)']], [5.0, 11.0])
S += [P('Für Hyper Backup genügt es, <b>data/backups/</b> und <b>data/uploads/</b> zu sichern. Zum Zurückspielen den Container stoppen, <i>bordbuch.db</i> durch eine Sicherung ersetzen und neu starten. '
        'Vor einem größeren Update lohnt eine Kopie von data/bordbuch.db.')]
S += H2('HTTPS, Zertifikat und Firewall')
S += CALL('Hinweis', 'Dieser Abschnitt beschreibt den vorgesehenen Zustand. Ob Reverse-Proxy, Zertifikatszuweisung und Firewall in DSM so gesetzt sind, prüfst du dort.')
S += B(['<b>Reverse-Proxy</b> in DSM (<i>Anmeldeportal → Erweitert → Reverse-Proxy</i>): HTTPS, Hostname 172.16.10.1, Port <b>8444</b> auf HTTP <b>localhost:8080</b>. Port 8443 belegt Vaultwarden.',
        '<b>Zertifikat „Bordbuch“</b> (selbst erzeugt für 172.16.10.1) wird dem Eintrag zugewiesen. Es ist in DSM importiert und läuft laut DSM am <b>22.02.2029</b> ab. Das Standardzertifikat von DSM bleibt unverändert.',
        '<b>Firewall</b> (<i>Sicherheit → Firewall</i>): Ports 8444 und 8080 nur für das Heimnetz und das WireGuard-Netz erlauben, für alle anderen Quellen verweigern. Im Router bleiben beide Ports geschlossen.',
        'Der private Schlüssel <b>bordbuch-key.pem</b> wird nach dem Import in DSM gelöscht.'])
S += [P('<b>Zertifikat erneuern</b> (vor dem Ablauf): neues Zertifikat erzeugen, in DSM importieren und dem Reverse-Proxy zuweisen, in Reisebuch unter <i>Dieses Gerät einrichten → Zertifikat verwalten</i> hochladen, danach auf jedem iPhone neu installieren und vertrauen.')]
S += CODE('openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout bordbuch-key.pem -out bordbuch.pem \\\n  -subj "/CN=Bordbuch" \\\n  -addext "subjectAltName=IP:172.16.10.1" \\\n  -addext "extendedKeyUsage=serverAuth"')
S += H2('Sicherheit auf einen Blick')
S += B(['Zugang nur über WireGuard-VPN, keine Portfreigabe im Router.',
        'API-Schlüssel nur in der .env (Rechte 600), nie in Git oder im Chat.',
        'SSH nur bei Bedarf einschalten.',
        'Das Admin-Konto sofort bei der Erstinstallation anlegen.',
        'Startpasswörter nur an die Person selbst senden und nach der Anmeldung ändern lassen.'])

# ---------------- 8 Fehlersuche ----------------
S += H1('Fehlersuche')
S += TBL([['Symptom', 'Wahrscheinliche Ursache', 'Lösung'],
          ['Seite lädt im VPN nicht', 'VPN aus, falsche Adresse, Container gestoppt', 'VPN prüfen, http://172.16.10.1:8080 testen, Container-Status prüfen'],
          ['Zertifikatswarnung auf dem iPhone', 'Zertifikat nicht installiert oder nicht vertraut', 'Kapitel 2, Schritt 1 wiederholen und „vollständig vertrauen“ aktivieren'],
          ['Kein „Teilen …“-Knopf, kein Zwischenablage-Knopf', 'Seite über http geöffnet', 'Über die HTTPS-Adresse öffnen'],
          ['Erinnerungen lassen sich nicht aktivieren', 'Kein HTTPS oder nicht vom Home-Bildschirm geöffnet', 'Schritte 1 und 2 erledigen; die Einstellungsseite nennt den Grund'],
          ['Testnachricht kommt nicht an', 'Syno ohne Internet, Mitteilungen im iPhone aus', 'Meldung in den Einstellungen lesen, iPhone-Einstellungen → Reisebuch → Mitteilungen'],
          ['„Nicht eingerichtet“ bei der KI', '.env fehlt oder Container nicht neu gestartet', '.env anlegen, dann docker compose up -d'],
          ['„API-Schlüssel abgelehnt“', 'Schlüssel falsch oder deaktiviert', 'Neuen Schlüssel in der Console erzeugen, .env ersetzen, Container neu starten'],
          ['Dokument wird nicht gelesen', 'Dateityp oder Größe', 'PDF, Foto oder Text verwenden; Grenzen in Kapitel 4'],
          ['Logo fehlt auf dem Home-Bildschirm', 'Kachel wurde vor dem Update oder über eine andere Adresse angelegt', 'Kachel löschen und über die HTTPS-Adresse neu anlegen'],
          ['git pull meldet lokale Änderungen', 'Dateien im Projektordner von Hand geändert', 'Meldung prüfen; Einstellungen gehören in die .env, nicht in Projektdateien'],
          ['Version auf dem Gerät älter als auf dem Server', 'Zwischenspeicher der Home-Bildschirm-App', 'Einstellungen → Über Reisebuch → App neu laden, notfalls App schließen und neu öffnen'],
          ['Nach dem Update noch alte Version', 'git pull nicht ausgeführt oder Image aus dem Zwischenspeicher', 'cat VERSION im Projektordner prüfen; sonst docker compose build --no-cache und up -d'],
          ['Recherche findet nichts', 'Keine prüfbaren Quellen oder zu vage Suche', '„Was wurde gesucht?“ lesen; Link zur Reise angeben; bei Fehlertext der API die Websuche in der Anthropic-Console prüfen'],
          ['App heißt noch Bordbuch / Schiff-Logo', 'Kachel vor der Umbenennung angelegt', 'Kachel entfernen und über die HTTPS-Adresse neu anlegen, Erinnerungen neu aktivieren'],
          ['Zu lange Namen verbreitern die Seite', 'Ältere Version vor 0.3.1', 'Auf 0.3.1 oder neuer aktualisieren'],
          ['Alles gesperrt, „Bearbeiten“ mit Schloss', 'Ansichtsmodus: die Reise läuft', 'Auf „Verlassen“ tippen und die Warnung bestätigen'],
          ['Betrag ohne Währung', 'Im Dokument stand keine Währung', 'Beim Eintrag die Währung (z. B. EUR) setzen'],
          ['Passwort vergessen', '—', 'Admin: Einstellungen → Familie → Passwort']], [4.4, 5.0, 6.6])

# ---------------- 9 Stand ----------------
S += H1('Stand und Ausblick')
S += [P('Aktuelle App-Version: <b>%s</b>, Datenbank-Stand 8.' % VERSION + ' Sie steht in den Einstellungen unter „Über Reisebuch“ und auf der Anmeldeseite.')]
S += [Paragraph('<b>Seit der ersten Fassung (0.1.0) neu</b>', body)]
S += TBL([['Version', 'Neu'],
          ['0.2.0', 'Anzeige der App-Version, „App neu laden“'],
          ['0.3.0 / 0.3.1', 'Optionale Web-Recherche für Lücken; lange Dateinamen verbreitern die Seite nicht mehr'],
          ['0.4.0 / 0.4.1', 'Recherche mit Reiseverlauf, Link zur Reise und Diagnose; Einschiffung und Ausschiffung in der Kreuzfahrt-Karte benannt'],
          ['0.5.0', 'Knopf „Prüfen“: KI-Durchsicht der ganzen Reise'],
          ['0.6.0', 'Reisearten (Kreuzfahrt, Städtetrip/Urlaub, Rundreise), Stationen mit Prüfung'],
          ['0.6.1', 'Umbenennung in Reisebuch, neues Kompass-Logo'],
          ['0.6.2', 'Zeitleiste: Vergangenes ausgegraut und Jetzt-Markierung; Hinweis zur Wartezeit vor der Einschiffung korrigiert'],
          ['0.6.3', 'Ausschiffung: Rechnung ab frühestem Von-Bord-Gehen (06:00) bei eigener Abreise; Bord-ABC liefert die Infos des eigenen Schiffs'],
          ['0.6.4', 'Währung: keine Annahme „CHF“ mehr, Betrag ohne Währung wird als solcher gezeigt'],
          ['0.7.0', 'Hinweise quittieren; Ansichtsmodus während der Reise'],
          ['0.8.0', 'Gate, Check-in-Schalter, Kofferband, Gleis; Push bei Änderung; Kabine gut sichtbar']], [3.2, 12.8])
S += [CondPageBreak(6 * cm), Paragraph('<b>Geplant</b>', body)]
S += TBL([['Geplant', 'Hinweis'],
          ['iOS-App (SwiftUI)', 'Widgets, Live-Aktivität, Erinnerungen nach Standort im Hintergrund; Bau auf dem Mac, API ist in docs/API.md beschrieben'],
          ['Automatisch übernehmen, wenn die KI sicher ist', 'Heute immer mit Prüfung'],
          ['Dokument an mehrere Einträge hängen', 'Heute am ersten Eintrag'],
          ['Bordzeit gegenüber Ortszeit', 'Schiffe stellen die Uhr nicht immer um'],
          ['Kostenauswertung', 'Summen je Reise, Währung und Art; vorgemerkt für die nächsten Tage'],
          ['Packliste und Kostenübersicht pro Person', '—']], [8.0, 8.0])

doc.multiBuild(S)
print('ok', OUT)
