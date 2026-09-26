# Yemekhane (cafeteria menu) for NodeBB

A widget that shows the day's cafeteria menu on your forum: breakfast, lunch and dinner, with calories and prices. Built for [Yaşar Forum](https://yu.uniforum.app) (Yaşar University), but the menu format is plain JSON, so any cafeteria can use it.

- The three meals sit side by side. The next meal is highlighted using Istanbul time (breakfast until 10:30, lunch until 15:00, dinner until 20:00, then tomorrow's breakfast). Moving to a later day opens its breakfast unless the visitor picked a meal tab.
- Arrows move between days. Other months load on demand.
- Main dishes stand out, and the side dishes served every day are grouped into one line.
- The set menu price and the à la carte prices are shown in their own box.
- On narrow screens the meals turn into tabs.
- The first view is rendered on the server, so nothing jumps when the page loads.
- Light and dark themes, Turkish and English.
- Optionally takes the place of the category list on the home page. `/categories` keeps the list.

Requires NodeBB 4.15 or later.

## Installation

    npm install nodebb-plugin-yemekhane

Activate the plugin in the ACP, then rebuild and restart NodeBB.

## Setup

1. Open **ACP → Plugins → Yemekhane** and upload a month's menu as a JSON file.
2. In **ACP → Extend → Widgets**, drag the **Yemekhane** widget into an area. The `header` area of the categories template works well.
3. Widget options:
   - **Show on the home page only.** When the home page is the category list, `/` and `/categories` share one template. This keeps the widget off `/categories`.
   - **Hide the category list on the home page.** The menu takes the list's place on `/`.
   - **Hide breakfast** and **Hide prices.**

When no menu has been uploaded yet, the widget renders nothing.

## Monthly menu from a PDF

`tools/pdf2json.py` converts the monthly PDF published by SMC Catering (the format used at Yaşar University) into the JSON below. It needs Python 3.8+ and poppler's `pdftotext` 22 or later.

    python3 tools/pdf2json.py yemek-liste.pdf > 2026-10.json

The script finds the lunch, dinner and dormitory breakfast pages by their titles. It reads each day's column, matches every calorie value to the dish on the same line and fixes known typos in the source. Warnings go to stderr. Always look over the result before uploading.

## JSON format

```json
{
  "ay": "2026-09",
  "kaynak": "https://www.yasar.edu.tr/yemek-liste.pdf",
  "etiketler": { "kahvalti": "Yurt" },
  "fiyat": {
    "set": "202,50 TL",
    "cesit": 4,
    "liste": [["Çorba", "56,50 TL"], ["Ana yemek", "113,00 TL"]],
    "notlar": ["Vegan seçenek de var."]
  },
  "gunler": {
    "2026-09-01": {
      "kahvalti": [{ "ad": "Beyaz Peynir", "kcal": 160, "tur": "yan" }],
      "ogle": [
        { "ad": "Şehriye Çorbası", "kcal": 180, "tur": "corba" },
        { "ad": "Piliç Pirzola + Patates Cips", "kcal": 320, "tur": "ana" },
        { "ad": "Yoğurt/Ayran", "kcal": "120/116", "tur": "sabit" }
      ],
      "aksam": []
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `ay` | Month, `YYYY-MM`. Required. |
| `gunler` | Days of that month, `YYYY-MM-DD` → meals. Each meal is `kahvalti`, `ogle` or `aksam`. Required. |
| `ad` | Dish name, up to 120 characters. |
| `kcal` | A number, a text like `"120/116"`, or `null`. |
| `tur` | `corba` (soup), `ana` (main, shown bold), `yan` (side), `tatli` (dessert), `salata` (salad) or `sabit` (served every day, grouped into the "Also served" line). |
| `kaynak` | Link to the original menu, shown as "Monthly menu (PDF)". |
| `etiketler` | A small tag next to a meal's name, for example `"Yurt"` (dormitory) for breakfast. |
| `fiyat` | Set menu price, how many items it includes, à la carte prices and notes. |

`examples/2026-09.json` is a complete month.

## API

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/api/v3/plugins/yemekhane/aylar/:ay` | Everyone |
| `PUT` | `/api/v3/plugins/yemekhane/aylar/:ay` (JSON body) | Administrators |
| `DELETE` | `/api/v3/plugins/yemekhane/aylar/:ay` | Administrators |

Uploads are validated. Unknown fields are dropped, and errors say which day or dish is wrong.

## Development

    npm install
    npm test
    npm run lint

## License

MIT. Icons are from [Lucide](https://lucide.dev) (ISC).
