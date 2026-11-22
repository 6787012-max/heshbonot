# -*- coding: utf-8 -*-
"""בדיקת צד-שרת מקצה לקצה (כניסה עם גוגל: הרשאה לפי חברות ב-members והזמנה במייל). יוצר עסק בדיקה ושני משתמשי בדיקה, ומוחק הכול בסוף."""
import io, json, os, secrets, string, sys, time, uuid
import urllib3, requests
urllib3.disable_warnings()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sb

c = sb.creds()
BASE = "https://%s.supabase.co" % c["ref"]
ANON, SVC = c["anon"], c["service"]
UA = {"User-Agent": "Mozilla/5.0"}
RES = []


def check(name, ok, info=""):
    RES.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (" | " + str(info)[:160] if info else ""))


def pw():
    return "Aa1!" + "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))


def admin_create(email, password):
    r = requests.post(BASE + "/auth/v1/admin/users", verify=False, headers={**UA, "apikey": SVC, "Authorization": "Bearer " + SVC},
                      json={"email": email, "password": password, "email_confirm": True})
    return r.json()["id"]


def login(email, password):
    r = requests.post(BASE + "/auth/v1/token?grant_type=password", verify=False, headers={**UA, "apikey": ANON},
                      json={"email": email, "password": password})
    return r.json()


def H(tok, schema="heshbonot"):
    return {**UA, "apikey": ANON, "Authorization": "Bearer " + tok, "Accept-Profile": schema,
            "Content-Profile": schema, "Content-Type": "application/json", "Prefer": "return=representation"}


def get(tok, path):
    return requests.get(BASE + "/rest/v1/" + path, verify=False, headers=H(tok))


def post(tok, path, body):
    return requests.post(BASE + "/rest/v1/" + path, verify=False, headers=H(tok), json=body)


def rpc(tok, fn, body):
    return requests.post(BASE + "/rest/v1/rpc/" + fn, verify=False, headers=H(tok), json=body)


tag = uuid.uuid4().hex[:8]
e1, e2 = "zz-test-%s-a@example.com" % tag, "zz-test-%s-b@example.com" % tag
p1, p2 = pw(), pw()
u1 = admin_create(e1, p1)
u2 = admin_create(e2, p2)
st, out = sb.run_sql("insert into heshbonot.businesses(name, vat_type) values ('בדיקה-%s','authorized') returning id" % tag)
bid = json.loads(out)[0]["id"]
sb.run_sql("insert into heshbonot.invites(email, business_id, role) values ('%s','%s','owner')" % (e1.upper(), bid))
BIZ2 = None
try:
    s1 = login(e1, p1)
    tok1 = s1["access_token"]
    # --- משתמש מחובר בלי חברות (עוד לפני claim_invites) ---
    for tb in ("businesses", "members", "documents", "contacts", "expenses", "bank_txns", "audit_log", "doc_sequences"):
        r = get(tok1, tb + "?select=*")
        check("מחובר בלי members: %s מחזיר 0 שורות" % tb, r.status_code == 200 and r.json() == [], r.text[:80])
    r = rpc(tok1, "issue_document", {"p": {"business_id": bid, "doc_type": "tax_invoice", "customer_name": "x",
                                            "items": [{"description": "a", "qty": 1, "unit_price": 10}]}})
    check("מחובר בלי members: הפקת מסמך נחסמת", r.status_code >= 400, r.text[:100])
    r = requests.get(BASE + "/rest/v1/businesses?select=id", verify=False, headers={**UA, "apikey": ANON, "Authorization": "Bearer " + ANON, "Accept-Profile": "heshbonot"})
    check("anon: נחסם", r.status_code in (401, 403, 404) or r.json() == [], "%s %s" % (r.status_code, r.text[:80]))
    r = requests.get(BASE + "/rest/v1/invites?select=*", verify=False, headers=H(tok1))
    check("authenticated לא קורא את invites", r.status_code >= 400 or r.json() == [], "%s %s" % (r.status_code, r.text[:80]))
    r = requests.post(BASE + "/rest/v1/invites", verify=False, headers=H(tok1), json={"email": e1, "business_id": bid, "role": "owner"})
    check("authenticated לא כותב ל-invites", r.status_code >= 400, "%s %s" % (r.status_code, r.text[:80]))
    r = requests.post(BASE + "/rest/v1/members", verify=False, headers=H(tok1), json={"user_id": u1, "business_id": bid, "role": "owner"})
    check("authenticated לא מוסיף את עצמו ל-members", r.status_code >= 400, "%s %s" % (r.status_code, r.text[:80]))
    r = requests.post(BASE + "/rest/v1/rpc/claim_invites", verify=False, headers={**UA, "apikey": ANON, "Authorization": "Bearer " + ANON, "Content-Profile": "heshbonot", "Content-Type": "application/json"}, json={})
    check("anon לא מריץ claim_invites", r.status_code >= 400, "%s %s" % (r.status_code, r.text[:80]))

    # --- משתמש בלי הזמנה: claim_invites לא נותן כלום ---
    t2 = login(e2, p2)["access_token"]
    r = rpc(t2, "claim_invites", {})
    check("claim_invites בלי הזמנה: ללא שגיאה", r.status_code < 300, r.text[:80])
    for tb in ("businesses", "documents", "contacts", "expenses", "bank_txns", "audit_log", "members"):
        rr = get(t2, tb + "?select=*")
        check("אחרי claim בלי הזמנה: %s מחזיר 0" % tb, rr.status_code == 200 and rr.json() == [], rr.text[:80])
    r = rpc(t2, "issue_document", {"p": {"business_id": bid, "doc_type": "tax_invoice", "customer_name": "x",
                                          "items": [{"description": "a", "qty": 1, "unit_price": 10}]}})
    check("בלי הזמנה: הפקה נחסמת", r.status_code >= 400, r.text[:100])

    # --- משתמש עם הזמנה (מייל בהתאמת אותיות שונה) מקבל גישה אחרי claim_invites ---
    r = rpc(tok1, "claim_invites", {})
    check("claim_invites עם הזמנה", r.status_code < 300, r.text[:80])
    r = rpc(tok1, "claim_invites", {})
    check("claim_invites חוזר (idempotent)", r.status_code < 300, r.text[:80])
    st, out = sb.run_sql("select count(*) n, min(role) r from heshbonot.members where user_id='%s' and business_id='%s'" % (u1, bid))
    check("נוצרה שורת members אחת בתפקיד owner", json.loads(out)[0]["n"] == 1 and json.loads(out)[0]["r"] == "owner", out[:80])
    tok = tok1

    # --- עם חברות (owner) ---
    r = get(tok, "businesses?select=id,name")
    check("owner: רואה את העסק", r.status_code == 200 and len(r.json()) == 1, r.text[:100])
    r = post(tok, "contacts", {"business_id": bid, "kind": "customer", "name": "לקוח בדיקה", "tax_id": "514000000"})
    cust_id = r.json()[0]["id"] if r.status_code < 300 else None
    check("יצירת לקוח", cust_id is not None, r.text[:100])
    # ח.פ תקין לדוגמה: 514290185? נחשב בקוד
    def mkid(base8):
        for d in range(10):
            s = base8 + str(d)
            tot = 0
            for i, ch_ in enumerate(s):
                x = int(ch_) * (1 if i % 2 == 0 else 2)
                tot += x - 9 if x > 9 else x
            if tot % 10 == 0:
                return s
    vid = mkid("51429018")
    inv = {"business_id": bid, "doc_type": "tax_invoice", "contact_id": cust_id, "customer_name": "לקוח בדיקה",
           "customer_tax_id": vid, "issue_date": "2026-11-05", "due_date": "2026-12-05",
           "items": [{"description": "שירות א", "qty": 2, "unit_price": 1000, "discount_pct": 0}]}
    r = rpc(tok, "issue_document", {"p": inv})
    check("חשבונית מס מס' 1", r.status_code == 200 and r.json()["number"] == 1, r.text[:120])
    inv1 = r.json().get("id")
    inv["items"] = [{"description": "שירות ב", "qty": 1, "unit_price": 500}]
    r = rpc(tok, "issue_document", {"p": inv})
    check("חשבונית מס מס' 2 (רצף)", r.status_code == 200 and r.json()["number"] == 2, r.text[:120])
    r = rpc(tok, "issue_document", {"p": {**inv, "customer_tax_id": "123456789"}})
    check("ח.פ עם ספרת ביקורת שגויה נחסם", r.status_code >= 400 and "ספרת" in r.text, r.text[:120])
    # הקצאה
    big = {**inv, "items": [{"description": "גדול", "qty": 1, "unit_price": 6000}]}
    r = rpc(tok, "issue_document", {"p": big})
    check("מעל סף ללקוח עוסק בלי הקצאה נחסם", r.status_code >= 400 and "הקצאה" in r.text, r.text[:120])
    r = rpc(tok, "issue_document", {"p": {**big, "allocation_number": "ABC123456"}})
    check("עם מספר הקצאה מופק (מס' 3)", r.status_code == 200 and r.json()["number"] == 3, r.text[:120])
    # אי-שינוי
    r = requests.patch(BASE + "/rest/v1/documents?id=eq." + inv1, verify=False, headers=H(tok), json={"total": 1})
    check("UPDATE ישיר על מסמך נחסם", r.status_code >= 400, "%s %s" % (r.status_code, r.text[:80]))
    r = requests.delete(BASE + "/rest/v1/documents?id=eq." + inv1, verify=False, headers=H(tok))
    check("DELETE ישיר על מסמך נחסם", r.status_code >= 400 or r.text in ("[]", ""), "%s %s" % (r.status_code, r.text[:80]))
    st, out = sb.run_sql("update heshbonot.documents set total = 1 where id = '%s'" % inv1)
    check("UPDATE גם כבעלים (postgres) נחסם בטריגר", st >= 400 and "לא ניתן לעריכה" in out, out[:100])
    st, out = sb.run_sql("delete from heshbonot.documents where id = '%s'" % inv1)
    check("DELETE גם כבעלים נחסם בטריגר", st >= 400 and "לא ניתן למחיקה" in out, out[:100])
    st, out = sb.run_sql("update heshbonot.document_items set qty = 9 where document_id = '%s'" % inv1)
    check("UPDATE על שורות מסמך נחסם", st >= 400, out[:100])
    # קבלה סוגרת
    rc = {"business_id": bid, "doc_type": "receipt", "contact_id": cust_id, "customer_name": "לקוח בדיקה",
          "customer_tax_id": vid, "issue_date": "2026-11-10", "related_doc_id": inv1,
          "payments": [{"method": "transfer", "amount": 2360, "reference": "123"}]}
    r = rpc(tok, "issue_document", {"p": rc})
    check("קבלה מס' 1 סוגרת את חשבונית 1 (2000+18%)", r.status_code == 200 and r.json()["number"] == 1, r.text[:120])
    r = get(tok, "documents?id=eq.%s&select=payment_status,paid_amount,total" % inv1)
    check("חשבונית 1 במצב שולם", r.json()[0]["payment_status"] == "paid" and float(r.json()[0]["paid_amount"]) == 2360, r.text[:120])
    r = rpc(tok, "issue_document", {"p": rc})
    check("קבלה נוספת על חשבונית סגורה נחסמת", r.status_code >= 400, r.text[:100])
    # זיכוי
    cn = {"business_id": bid, "doc_type": "credit_note", "customer_name": "לקוח בדיקה", "related_doc_id": inv1,
          "issue_date": "2026-11-12", "items": [{"description": "זיכוי", "qty": 1, "unit_price": 2000}]}
    # זיכוי לחשבונית שולמה: מותר (מחזירים)
    r = rpc(tok, "issue_document", {"p": cn})
    check("חשבונית זיכוי מבטלת חשבונית", r.status_code == 200, r.text[:120])
    r = get(tok, "documents?id=eq.%s&select=status" % inv1)
    check("חשבונית 1 בסטטוס cancelled", r.json()[0]["status"] == "cancelled", r.text[:80])
    # הוצאה
    r = post(tok, "expenses", {"business_id": bid, "supplier_name": "ספק", "expense_date": "2026-11-08", "category": "רכב",
                               "amount_net": 600, "vat_amount": 108, "vat_recognized_pct": 66.67})
    check("הוצאה נוצרה עם מע\"מ מוכר 72.00", r.status_code < 300 and abs(float(r.json()[0]["vat_recognized"]) - 72.0) < 0.01, r.text[:120])
    exp_id = r.json()[0]["id"] if r.status_code < 300 else None
    # דוחות. נתוני בדיקה: חשבונית2 500 (+90), חשבונית3 6000 (+1080), חשבונית1 2000 (+360) מבוטלת בזיכוי -2000 (-360)
    r = rpc(tok, "report_vat", {"bid": bid, "d1": "2026-11-01", "d2": "2026-11-30"})
    j = r.json()
    ok = abs(j["sales_net"] - 6500 - 2000 + 2000) < 0.01 or True
    exp_sales = 2000 + 500 + 6000 - 2000
    exp_out = 360 + 90 + 1080 - 360
    check("דוח מע\"מ: עסקאות %d, מע\"מ עסקאות %d, תשומות 72, לתשלום %d" % (exp_sales, exp_out, exp_out - 72),
          abs(j["sales_net"] - exp_sales) < .01 and abs(j["output_vat"] - exp_out) < .01 and abs(j["input_vat"] - 72) < .01
          and abs(j["payable"] - (exp_out - 72)) < .01, r.text[:200])
    r = rpc(tok, "report_pnl", {"bid": bid, "d1": "2026-11-01", "d2": "2026-11-30"})
    j = r.json()
    exp_cost = 600 + 108 - 72
    check("רווח והפסד: הכנסות %d, הוצאות %d" % (exp_sales, exp_cost),
          abs(j["income"] - exp_sales) < .01 and abs(j["expenses"] - exp_cost) < .01, r.text[:200])
    r = rpc(tok, "report_dashboard", {"bid": bid})
    check("לוח בקרה מחזיר חובות פתוחים", r.status_code == 200 and r.json()["open_count"] == 2 and abs(r.json()["open_debt"] - (590 + 7080)) < .01, r.text[:200])

    # --- בנק: ייבוא CSV והתאמה (בצד שרת: שמירה + כפילויות) ---
    h = "h-%s" % tag
    row = {"business_id": bid, "txn_date": "2026-11-15", "description": "העברה מלקוח בדיקה", "credit": 590, "debit": 0, "hash": h}
    r = post(tok, "bank_txns", row)
    check("שמירת תנועת בנק", r.status_code < 300, r.text[:100])
    r = post(tok, "bank_txns", row)
    check("כפילות תנועה נחסמת (hash ייחודי)", r.status_code >= 400, r.text[:100])
    # --- viewer ---
    sb.run_sql("update heshbonot.members set role='viewer' where user_id='%s'" % u1)
    time.sleep(0.5)
    r = get(tok, "documents?select=id")
    check("viewer קורא", r.status_code == 200 and len(r.json()) >= 3, r.text[:60])
    r = post(tok, "contacts", {"business_id": bid, "name": "נחסם"})
    check("viewer לא כותב", r.status_code >= 400, r.text[:100])
    r = rpc(tok, "issue_document", {"p": inv})
    check("viewer לא מפיק", r.status_code >= 400, r.text[:100])
    sb.run_sql("update heshbonot.members set role='owner' where user_id='%s'" % u1)
    # audit
    st, out = sb.run_sql("select count(*) n from heshbonot.audit_log where business_id='%s'" % bid)
    check("יומן ביקורת נרשם", json.loads(out)[0]["n"] >= 8, out[:60])
    # מספר התחלתי
    r = rpc(tok, "set_start_number", {"bid": bid, "dtype": "quote", "n": 500})
    check("מספר התחלתי להצעת מחיר 500", r.status_code < 300, r.text[:100])
    r = rpc(tok, "issue_document", {"p": {"business_id": bid, "doc_type": "quote", "customer_name": "ל",
                                          "items": [{"description": "x", "qty": 1, "unit_price": 100}]}})
    check("הצעת מחיר מקבלת 500", r.status_code == 200 and r.json()["number"] == 500, r.text[:100])
    r = rpc(tok, "set_start_number", {"bid": bid, "dtype": "quote", "n": 3})
    check("חזרה אחורה במספור נחסמת", r.status_code >= 400, r.text[:100])
finally:
    # ניקוי: כבה טריגרים (replica) ומחק
    sql = ("set session_replication_role = replica; "
           "delete from heshbonot.audit_log where business_id='%s'; " % bid +
           "".join("delete from heshbonot.%s where business_id='%s'; " % (tb, bid) for tb in
                   ("document_items", "document_payments", "documents", "contacts", "expenses", "bank_txns", "doc_sequences", "members")) +
           "delete from heshbonot.businesses where id='%s'; delete from auth.users where id in ('%s','%s');" % (bid, u1, u2))
    st, out = sb.run_sql(sql)
    print("ניקוי:", st, out[:100] if st >= 300 else "ok")
    st, out = sb.run_sql("select (select count(*) from heshbonot.documents where business_id='%s') d, (select count(*) from auth.users where email like 'zz-test-%s%%') u" % (bid, tag))
    print("שאריות:", out[:100])
bad = [n for n, ok in RES if not ok]
print("סה\"כ %d בדיקות, נכשלו %d" % (len(RES), len(bad)))
for n in bad:
    print("  FAIL:", n)
