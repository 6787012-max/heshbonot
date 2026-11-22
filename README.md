# הנהלת חשבונות לעסק קטן

אתר סטטי (HTML + ES modules, ללא build) בעברית RTL: חשבוניות, קבלות, הצעות מחיר, לקוחות וספקים, הוצאות,
ייבוא תנועות בנק עם התאמה אוטומטית, דוחות מע"מ / רווח והפסד / מקדמות / גיל חובות, תזכורות גבייה ויצוא לרואה חשבון.

- כתובת: https://heshbonot.mokad.co.il (גיבוי: https://6787012-max.github.io/heshbonot/)
- אחסון האתר: GitHub Pages, ריפו ציבורי `6787012-max/heshbonot` (בחשבון yossi6742853 Actions מושבת ולכן Pages לא נבנה שם), אפס סודות בריפו
- מסד ואימות: Supabase, פרויקט משותף `cmsusfmwjtpfewbydzpi`, schema נפרד `heshbonot`

## מבנה
| נתיב | תוכן |
|---|---|
| `index.html` | מעטפת + CSP מחמיר (בלי inline script/style) |
| `js/app.js` | נתב, סרגל צד, ניתוק אחרי 30 דקות, קיצורי מקשים (Alt+N מסמך חדש, / חיפוש, Ctrl+Enter הפקה) |
| `js/auth.js` | כניסה עם אימייל+סיסמה או גוגל (OAuth, PKCE), קליטת session אחרי החזרה, `claim_invites` |
| `js/api.js`, `js/config.js` | לקוח Supabase (URL + anon key ציבורי בלבד) |
| `js/il.js` | ספרת ביקורת, סכום במילים, עיצוב, חישוב סכומים |
| `js/bankparse.js`, `js/match.js` | פענוח CSV/XLSX (windows-1255/UTF-8), hash נגד כפילויות, התאמה אוטומטית |
| `js/uniform.js`, `js/zip.js` | מבנה אחיד (INI.TXT + BKMVDATA.TXT, ISO-8859-8) ו-ZIP |
| `js/pages/*.js` | דפי המערכת |
| `db/02_google_login.sql` | מעבר לכניסה עם גוגל: has_role בלי aal2, טבלת `invites`, `claim_invites()` |
| `db/01_schema.sql` | schema, טבלאות, טריגרים, RPC, RLS (כולל bucket פרטי לקבצים מצורפים) |
| `tools/` | `sb.py` (הרצת SQL דרך Management API), `setup.py` (עסק+משתמש ראשוני), `backup.py`, `test_e2e.py`, `t_*.mjs` |

## אבטחה
- **גרסת בטא: כניסה עם אימייל וסיסמה, או עם גוגל.** אין אימות דו-שלבי (TOTP) ואין החלפת סיסמה כפויה. משתמש נוסף עם עסק נפרד: `python tools/setup_user.py EMAIL "שם עסק" ~/.secrets/קובץ.txt` (סיסמה אקראית לקובץ, לא מודפסת); בידוד נבדק ב-`tools/test_isolation.py`. ההרשאה לנתונים נקבעת בשרת ולא לפי עצם ההתחברות.
- RLS על כל טבלה: דורש חברות ב-`heshbonot.members` (owner / accountant / viewer). משתמש מחובר בלי חברות: 0 שורות.
- חברות נוצרת מהזמנה לפי מייל: שורה ב-`heshbonot.invites` (מייל, עסק, תפקיד). בכניסה האתר קורא ל-`claim_invites()` (security definer), שמוסיף ל-members את המשתמש אם המייל שבחשבון הגוגל שלו (`auth.jwt()`) מופיע בהזמנה. לטבלת invites אין גישה ל-anon/authenticated. להזמנת משתמש: `insert into heshbonot.invites values ('mail@gmail.com','<business_id>','viewer')`.
- הגדרה בצד Supabase (Auth): ספק Google מופעל, ו-Redirect URL של האתר מורשה.
- anon אין לו שום גישה ל-schema. הרשמה עצמית בפרויקט לא נותנת גישה (אין שורת members).
- מסמך שהופק: טריגר חוסם UPDATE/DELETE (חוץ מסטטוס תשלום/ביטול/מונה הדפסות). הפקה רק דרך `issue_document` (מספור רציף עם נעילה, בדיקת מספר הקצאה וספרת ביקורת). ביטול = חשבונית זיכוי.
- יומן ביקורת (`audit_log`) בטריגרים. ניתוק אוטומטי אחרי 30 דקות. session נשמר ב-sessionStorage בלבד.
- service_role משמש רק בסקריפטים מקומיים (`tools/`), לעולם לא באתר.

## פריסה
1. `python tools/sb.py sql db/01_schema.sql` ואחריו `python tools/sb.py sql db/02_google_login.sql` (idempotent; 02 מחליף את has_role ואת מדיניות members מ-01).
2. `python tools/expose.py` מוסיף `heshbonot` ל-db_schema של ה-API (לא מסיר קיימים; גיבוי הערך הקודם ב-`_backups/`).
3. `python tools/setup.py` יוצר עסק ומשתמש owner; הסיסמה נכתבת ל-`~/.secrets/heshbonot-initial.txt` (לא מודפסת). (היסטורי; בגרסת הבטא נכנסים עם גוגל, ראו `db/02_google_login.sql`).
4. DNS: CNAME `heshbonot` -> `6787012-max.github.io.` ב-deSEC (`tools/desec.py add`), ואז הגדרת custom domain ב-Pages + `https_enforced`.
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
