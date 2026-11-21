# הנהלת חשבונות לעסק קטן

אתר סטטי (HTML + ES modules, ללא build) בעברית RTL: חשבוניות, קבלות, הצעות מחיר, לקוחות וספקים, הוצאות,
ייבוא תנועות בנק עם התאמה אוטומטית, דוחות מע"מ / רווח והפסד / מקדמות / גיל חובות, תזכורות גבייה ויצוא לרואה חשבון.

- כתובת: https://heshbonot.mokad.co.il (גיבוי: https://yossi6742853.github.io/heshbonot/)
- אחסון האתר: GitHub Pages (ריפו ציבורי, אפס סודות בו)
- מסד ואימות: Supabase, פרויקט משותף `cmsusfmwjtpfewbydzpi`, schema נפרד `heshbonot`

## מבנה
| נתיב | תוכן |
|---|---|
| `index.html` | מעטפת + CSP מחמיר (בלי inline script/style) |
| `js/app.js` | נתב, סרגל צד, ניתוק אחרי 30 דקות, קיצורי מקשים (Alt+N מסמך חדש, / חיפוש, Ctrl+Enter הפקה) |
| `js/auth.js` | כניסה, החלפת סיסמה בכניסה ראשונה, רישום TOTP (QR) ואימות חובה |
| `js/api.js`, `js/config.js` | לקוח Supabase (URL + anon key ציבורי בלבד) |
| `js/il.js` | ספרת ביקורת, סכום במילים, עיצוב, חישוב סכומים |
| `js/bankparse.js`, `js/match.js` | פענוח CSV/XLSX (windows-1255/UTF-8), hash נגד כפילויות, התאמה אוטומטית |
| `js/uniform.js`, `js/zip.js` | מבנה אחיד (INI.TXT + BKMVDATA.TXT, ISO-8859-8) ו-ZIP |
| `js/pages/*.js` | דפי המערכת |
| `db/01_schema.sql` | schema, טבלאות, טריגרים, RPC, RLS (כולל bucket פרטי לקבצים מצורפים) |
| `tools/` | `sb.py` (הרצת SQL דרך Management API), `setup.py` (עסק+משתמש ראשוני), `backup.py`, `test_e2e.py`, `t_*.mjs` |

## אבטחה
- RLS על כל טבלה: דורש `aal2` (אימות דו-שלבי) **וגם** חברות ב-`heshbonot.members` (owner / accountant / viewer). בלי אחד מהם: 0 שורות.
- anon אין לו שום גישה ל-schema. הרשמה עצמית בפרויקט לא נותנת גישה (אין שורת members).
- מסמך שהופק: טריגר חוסם UPDATE/DELETE (חוץ מסטטוס תשלום/ביטול/מונה הדפסות). הפקה רק דרך `issue_document` (מספור רציף עם נעילה, בדיקת מספר הקצאה וספרת ביקורת). ביטול = חשבונית זיכוי.
- יומן ביקורת (`audit_log`) בטריגרים. ניתוק אוטומטי אחרי 30 דקות. session נשמר ב-sessionStorage בלבד.
- service_role משמש רק בסקריפטים מקומיים (`tools/`), לעולם לא באתר.

## פריסה
1. `python tools/sb.py sql db/01_schema.sql` (idempotent).
2. `python tools/expose.py` מוסיף `heshbonot` ל-db_schema של ה-API (לא מסיר קיימים; גיבוי הערך הקודם ב-`_backups/`).
3. `python tools/setup.py` יוצר עסק ומשתמש owner; הסיסמה נכתבת ל-`~/.secrets/heshbonot-initial.txt` (לא מודפסת). המשתמש חייב להחליף סיסמה ולרשום MFA בכניסה הראשונה.
4. DNS: CNAME `heshbonot` -> `yossi6742853.github.io.` ב-deSEC (`tools/desec.py add`), ואז הגדרת custom domain ב-Pages + `https_enforced`.
5. לפני כל push: `python C:/tools/secret-audit/audit.py C:/projects/heshbonot`.

## גיבוי
`python tools/backup.py` מייצא את כל טבלאות `heshbonot` ל-JSON מוצפן (AES-GCM, מפתח ב-`~/.secrets/heshbonot-backup.key` שנוצר אוטומטית ואינו מודפס) ל-`Y:/offload-from-D/heshbonot-backups/` (או `_backups/` אם Y לא זמין). אין משימה מתוזמנת. באתר: "יצוא לרואה חשבון" > "ייצוא גיבוי" (JSON להורדה, לא מוצפן).

## בדיקות
`python tools/test_e2e.py` (שרת: RLS, MFA, מספור, אי-שינוי, הקצאה, דוחות; יוצר משתמשי בדיקה ומוחק) · `node tools/t_il.mjs` · `node tools/t_logic.mjs` (בנק, התאמה, מבנה אחיד, ZIP).

## פתוח / מגבלות (בכנות)
- חיבור API לשע"מ (מספר הקצאה אוטומטי) לא נבנה: דורש רישום תוכנה ברשות המסים. מספר ההקצאה מוזן ידנית.
- המבנה האחיד נבנה לפי המפרט כמיטב היכולת, **לא אומת מול סימולטור רשות המסים**; אורכי רשומות מאומתים מול המפרט כפי שנזכר, ופרטי שדות מסוימים (D110/D120/A000) להשלמה מול הסימולטור.
- דוחות לעסק פטור/חברה בסיסיים; אין מאזן, כרטסת, ניכוי במקור, מט"ח, ריבוי עסקים בממשק (המודל תומך).
- אין שליחת מיילים/וואטסאפ מהאתר (בכוונה): תזכורות גבייה מועתקות / נפתחות ב-mailto / wa.me.
