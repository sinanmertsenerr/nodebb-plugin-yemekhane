#!/usr/bin/env python3
"""Aylık yemekhane PDF'ini (SMC Catering biçimi) eklentinin JSON biçimine çevirir.

Kullanım:
    python3 tools/pdf2json.py yemek-liste.pdf > 2026-09.json

Gerekenler: Python 3.8+, poppler'ın pdftotext aracı (-tsv desteği, poppler 22+).
    macOS: brew install poppler    Debian/Ubuntu: apt install poppler-utils

Tablo sayfaları başlıklarından tanınır (ÖĞLE, AKŞAM, KAHVALTI). Her gün sütunu "tarih gün | ALERJEN | KALORİ"
başlığıyla başlar; yemekler x konumuna göre günlere, kaloriler aynı satırdaki yemeğe bağlanır.
"""

import argparse
import csv
import datetime
import io
import json
import re
import subprocess
import sys
from collections import defaultdict

DEFAULT_SOURCE = 'https://www.yasar.edu.tr/yemek-liste.pdf'
DATE = re.compile(r'^(\d{1,2})[./](\d{1,2})[./]?(\d{4})?$')
YEAR = re.compile(r'^\d{4}$')
DAY = re.compile(r'^\d{1,2}$')
# Başlıktaki tarih iki biçimde gelebiliyor: "1.09.2026 SALI" ya da "1 EKİM 2026 PERŞEMBE"
MONTHS = {'OCAK': 1, 'ŞUBAT': 2, 'MART': 3, 'NİSAN': 4, 'MAYIS': 5, 'HAZİRAN': 6, 'TEMMUZ': 7,
          'AĞUSTOS': 8, 'EYLÜL': 9, 'EKİM': 10, 'KASIM': 11, 'ARALIK': 12}
NUM = re.compile(r'^\d+(/\d+)?$')

# Kaynaktaki bilinen yazım hataları (büyük harfli hâlde düzeltilir)
UPPER_FIXES = [
    (r'YOĞURTU SEMİZOTU', 'YOĞURTLU SEMİZOTU'), (r'SEMİZ OTU', 'SEMİZOTU'), (r'KZIARTMASI', 'KIZARTMASI'),
    (r'ZETİNYAĞLI', 'ZEYTİNYAĞLI'), (r'HAVUÇU KEK', 'HAVUÇLU KEK'), (r'REÇETELİ', 'REÇELİ'), (r'ÇİİLEK', 'ÇİLEK'),
    (r'ALMAN APATATES', 'ALMAN PATATES'), (r'MEYVELİGREK', 'MEYVELİ GREK'), (r'MAKSİKA', 'MEKSİKA'),
    (r'ŞEHRİYELİBULGUR', 'ŞEHRİYELİ BULGUR'), (r'KAŞARPEYNİRİ', 'KAŞAR PEYNİRİ'), (r'ÜÜZMLÜ', 'ÜZÜMLÜ'),
    (r'ŞEFTALİL KEK', 'ŞEFTALİLİ KEK'), (r'PAMADOR', 'POMODORO'), (r'FASÜLYE', 'FASULYE'),
    # Ekim 2026
    (r'CORDON BLUE', 'CORDON BLEU'), (r'\bSPANGLE\b', 'SUPANGLE'), (r'KÖPEOĞLU', 'KÖPOĞLU'), (r'\bKIY\.\s*', 'KIYMALI '),
    (r'ARAB[İI]ATTA', 'ARRABBİATA'), (r'ŞN[İI]TZEL', 'ŞİNİTZEL'), (r'^DOMATES ÇORBASI?\s*\+\s*KAŞARLI$', 'KAŞARLI DOMATES ÇORBASI'),
    (r'^TAH[İI]N HELVA$', 'TAHİN HELVASI'), (r'^SÜTLÜ İRMİK$', 'SÜTLÜ İRMİK TATLISI'), (r'^TAHİNLİ KEMALPAŞA$', 'TAHİNLİ KEMALPAŞA TATLISI'),
    (r'\b(KALEM|TEPSİ) BÖREK$', r'\1 BÖREĞİ'),
    (r'ÇORBA$', 'ÇORBASI'), (r'^MEVSİM SALATA$', 'MEVSİM SALATASI'), (r'^(TULUM|ÖRGÜ|KAŞAR|LABNE) PEYNİR$', r'\1 PEYNİRİ'),
    (r'^TEREYAĞ$', 'TEREYAĞI'), (r'^SU 1/2$', 'SU'),
    # İki yemeği ayıran tire de artı olur: "KÖFTE-PATATES", "ŞİNİTZEL - PATATES" → "KÖFTE + PATATES"
    (r'(?<=\w)\s*-\s*(?=\w)', ' + '), (r'\s*\+\s*', ' + '), (r'\s+', ' '),
]
TITLE_FIXES = [('Browni', 'Brownie'), ('Cheese Cake', 'Cheesecake'), ('Magnolıa', 'Magnolia'), ('Cafe De Paris', 'Café de Paris')]

# Her gün verilen yanlar: widget bunları "Yanında" satırında toplar
STAPLES = {'Yoğurt/Ayran', 'Mevsim Salatası', 'Mevsim Meyvesi (2 Çeşit)', 'Mevsim Meyvesi', 'Su', 'Çay', 'Süt',
           'Domates', 'Salatalık', 'Siyah Zeytin', 'Yeşil Zeytin', 'Tereyağı'}
DESSERT = re.compile(r'Tatlısı|Kek\b|Sütlaç|Keşkül|Höşmerim|Şokola|Puding|Muhallebi|Revani|Baklava|Kadayıf|Brownie|'
                     r'Cheesecake|Pasta|Kurabiye|Şekerpare|Kalburabastı|Supangle|Magnolia|Laz Böreği|Etimek|'
                     r'Profiterol|Kazandibi|Tiramisu|Trileçe|Helvası|Uyutma|İnci Tanesi')
SALAD = re.compile(r'Salata|Piyaz|Tabule')


def warn(msg):
    print(f'uyarı: {msg}', file=sys.stderr)


def lower_tr(s):
    return s.replace('I', 'ı').replace('İ', 'i').lower()


def upper_first_tr(w):
    c = w[0]
    return ('İ' if c == 'i' else 'I' if c == 'ı' else c.upper()) + w[1:]


def title_tr(s):
    return re.sub(r'(^|[\s(/+])(\w)', lambda m: m.group(1) + upper_first_tr(m.group(2)), lower_tr(s))


def sentence_tr(s):
    s = lower_tr(s).strip()
    return upper_first_tr(s) if s else s


def clean_name(raw):
    s = raw.strip()
    for a, b in UPPER_FIXES:
        s = re.sub(a, b, s)
    s = title_tr(s.strip())
    for a, b in TITLE_FIXES:
        s = s.replace(a, b)
    return s


def dish_type(meal, name, previous):
    if name in STAPLES:
        return 'sabit'
    if meal == 'kahvalti':
        return 'yan'
    if 'Çorba' in name:
        return 'corba'
    if DESSERT.search(name):
        return 'tatli'
    if SALAD.search(name):
        return 'salata'
    return 'yan' if 'ana' in previous else 'ana'


def kcal_value(v):
    if v is None:
        return None
    return int(v) if v.isdigit() else v


def read_words(pdf):
    out = subprocess.run(['pdftotext', '-tsv', pdf, '-'], check=True, capture_output=True, text=True).stdout
    pages = defaultdict(list)
    reader = csv.reader(io.StringIO(out), delimiter='\t', quoting=csv.QUOTE_NONE)
    next(reader)
    for row in reader:
        if row[0] != '5':
            continue
        x, y, w, h = map(float, row[6:10])
        pages[int(row[1])].append({'x0': x, 'x1': x + w, 'y': y + h / 2, 't': row[11]})
    return pages


def read_text(pdf, page):
    return subprocess.run(['pdftotext', '-f', str(page), '-l', str(page), '-layout', pdf, '-'],
                          check=True, capture_output=True, text=True).stdout


def lines_of(ws, tol=1.2):
    out = []
    for w in sorted(ws, key=lambda w: (w['y'], w['x0'])):
        if out and abs(out[-1][0]['y'] - w['y']) <= tol:
            out[-1].append(w)
        else:
            out.append([w])
    return [sorted(line, key=lambda w: w['x0']) for line in out]


def phrases(ws, gap=2.2):
    out = []
    for w in ws:
        if out and w['x0'] - out[-1][-1]['x1'] <= gap:
            out[-1].append(w)
        else:
            out.append([w])
    return [{'x0': p[0]['x0'], 'x1': p[-1]['x1'], 'y': sum(w['y'] for w in p) / len(p),
             't': ' '.join(w['t'] for w in p)} for p in out]


def meal_of_page(ws):
    words = {w['t'] for w in ws}
    if 'ALERJEN' not in words:
        return None, False
    if 'KAHVALTI' in words:
        return 'kahvalti', 'YURT' in words
    if 'AKŞAM' in words:
        return 'aksam', False
    if 'ÖĞLE' in words:
        return 'ogle', False
    return None, False


def date_at(line, j):
    """j'deki sözcükte bir gün başlığı başlıyorsa (gün, ay, yıl, kullanılan sözcük sayısı) döner."""
    t = line[j]['t']
    m = DATE.match(t)
    if m:
        return int(m.group(1)), int(m.group(2)), m.group(3), 1
    if DAY.match(t) and j + 1 < len(line) and line[j + 1]['t'] in MONTHS:
        return int(t), MONTHS[line[j + 1]['t']], None, 2
    return None


def header_days(line):
    days = []
    j = 0
    while j < len(line):
        found = date_at(line, j)
        if not found:
            j += 1
            continue
        d, mo, year, used = found
        span = line[j:j + used]
        k = j + used
        while k < len(line):
            t = line[k]['t']
            if t in ('ALERJEN', 'KALORİ') or date_at(line, k):
                break
            if not year and YEAR.match(t):
                year = t
            span.append(line[k])
            k += 1
        days.append({'d': d, 'm': mo, 'y': int(year) if year else None,
                     'nx': (span[0]['x0'] + span[-1]['x1']) / 2})
        j = k
    return days


def parse_meal_page(ws, meal, result):
    ls = lines_of(ws)
    stop = next((i for i, l in enumerate(ls) if any(w['t'].startswith('YEMEKHANEM') for w in l)), len(ls))
    heads = [i for i, l in enumerate(ls[:stop]) if any(w['t'] == 'ALERJEN' for w in l)]
    for hi, h in enumerate(heads):
        hl = ls[h]
        days = sorted(header_days(hl), key=lambda d: d['nx'])
        al = sorted((w['x0'] + w['x1']) / 2 for w in hl if w['t'] == 'ALERJEN')
        ka = sorted((w['x0'] + w['x1']) / 2 for w in hl if w['t'] == 'KALORİ')
        if not (len(days) == len(al) == len(ka)):
            warn(f'{meal}: başlık satırında {len(days)} gün, {len(al)} alerjen, {len(ka)} kalori sütunu var')
        for d, a, k in zip(days, al, ka):
            d.update(ax=a, kx=k, names=[], kcal=[])
        days = [d for d in days if 'kx' in d]
        if not days:
            continue
        end = heads[hi + 1] if hi + 1 < len(heads) else stop
        for line in ls[h + 1:end]:
            rest = []
            for w in line:
                cx = (w['x0'] + w['x1']) / 2
                if w['t'] == '*':
                    continue
                if NUM.match(w['t']):
                    dk = min(days, key=lambda d: abs(d['kx'] - cx))
                    if abs(dk['kx'] - cx) < 7:
                        dk['kcal'].append((w['y'], w['t']))
                        continue
                rest.append(w)
            for p in phrases(rest):
                cx = (p['x0'] + p['x1']) / 2
                min(days, key=lambda d: abs(d['nx'] - cx))['names'].append(p)
        for d in days:
            names = sorted(d['names'], key=lambda p: p['y'])
            if not names:
                continue
            # Her kalori en yakın satırdaki yemeğe gider
            kc = {}
            for y, v in d['kcal']:
                i = min(range(len(names)), key=lambda i: abs(names[i]['y'] - y))
                dy = abs(names[i]['y'] - y)
                if dy <= 5 and (i not in kc or dy < kc[i][0]):
                    kc[i] = (dy, v)
            d['items'] = [(p['t'], kc[i][1] if i in kc else None) for i, p in enumerate(names)]
            result.append((d, meal))


def parse_prices(text):
    lines = text.splitlines()
    rows, notes = [], []
    set_price, choices = None, None
    for line in lines:
        m = re.search(r'(\d+)\s*ÇEŞİT', line)
        if m and choices is None:
            choices = int(m.group(1))
        m = re.match(r'^\s*(.+?)\s*(?:FİYATI)?\s*;\s*([\d.]+(?:,\d{1,2})?)\s*TL', line)
        if m:
            label, price = m.group(1).strip(), m.group(2)
            if re.search(r'ANA\s*YEMEK\s*YER', label):
                notes.append('Büyük salata ana yemek yerine geçer.')
            label = re.sub(r'\s*\(.*?\)\s*', ' ', label).strip()
            label = re.sub(r'\s+ve\s+', ' / ', label, flags=re.I)
            if ',' not in price:
                price = f'{price},00'
            label = re.sub(r'/ (\w)', lambda x: '/ ' + upper_first_tr(x.group(1)), sentence_tr(label))
            rows.append([label, f'{price} TL'])
            continue
        m = re.search(r'(\d+,\d{2})\s*TL', line)
        if m and set_price is None and ';' not in line:
            set_price = f'{m.group(1)} TL'
    if re.search(r'VEGAN', text):
        notes.append('Vegan seçenek de var.')
    if not set_price:
        return None
    out = {'set': set_price, 'liste': rows, 'notlar': notes}
    if choices:
        out['cesit'] = choices
    return out


def main():
    ap = argparse.ArgumentParser(description='Yemekhane PDF → JSON')
    ap.add_argument('pdf')
    ap.add_argument('--source', default=DEFAULT_SOURCE, help='Widget altındaki "Aylık menü" bağlantısı')
    ap.add_argument('--pretty', action='store_true', help='Okunaklı (girintili) JSON yaz')
    args = ap.parse_args()

    pages = read_words(args.pdf)
    found, tags = [], {}
    for page in sorted(pages):
        meal, dorm = meal_of_page(pages[page])
        if meal:
            if dorm:
                tags[meal] = 'Yurt'
            parse_meal_page(pages[page], meal, found)
    if not found:
        sys.exit('hata: PDF içinde menü tablosu bulunamadı')

    years = [d['y'] for d, _ in found if d['y']]
    year = max(set(years), key=years.count) if years else datetime.date.today().year
    days = defaultdict(dict)
    for d, meal in found:
        iso = datetime.date(d['y'] or year, d['m'], d['d']).isoformat()
        if meal in days[iso]:
            warn(f'{iso} {meal} iki kez bulundu, ilki kullanıldı')
            continue
        items, kinds = [], []
        for raw, kc in d['items']:
            name = clean_name(raw)
            kind = dish_type(meal, name, kinds)
            kinds.append(kind)
            items.append({'ad': name, 'kcal': kcal_value(kc), 'tur': kind})
        days[iso][meal] = items

    months = sorted({k[:7] for k in days})
    if len(months) != 1:
        warn(f'birden fazla ay bulundu: {", ".join(months)}; en çok gün olan ay yazılıyor')
    month = max(months, key=lambda m: sum(k.startswith(m) for k in days))
    out = {'ay': month, 'kaynak': args.source}
    if tags:
        out['etiketler'] = tags
    prices = parse_prices(read_text(args.pdf, 1))
    if prices:
        out['fiyat'] = prices
    else:
        warn('fiyat listesi bulunamadı')
    out['gunler'] = {k: {m: days[k].get(m, []) for m in ('kahvalti', 'ogle', 'aksam')}
                     for k in sorted(days) if k.startswith(month)}

    missing = [m for m in ('kahvalti', 'ogle', 'aksam') if not any(m in v for v in days.values())]
    if missing:
        warn(f'bulunamayan öğün: {", ".join(missing)}')
    print(f'{month}: {len(out["gunler"])} gün', file=sys.stderr)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1 if args.pretty else None,
              separators=None if args.pretty else (',', ':'))
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
