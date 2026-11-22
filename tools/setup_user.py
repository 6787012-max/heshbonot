# -*- coding: utf-8 -*-
"""setup_user.py - יוצר משתמש (סיסמה אקראית, נכתבת לקובץ ולא מודפסת) ועסק נפרד בשמו, ומשייך כ-owner רק לעסק הזה.
הרצה: python tools/setup_user.py EMAIL "שם עסק" ~/.secrets/קובץ.txt
"""
import io, json, os, secrets, string, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sb

ARGS = sys.argv[1:]
if len(ARGS) < 3:
    raise SystemExit("usage: setup_user.py EMAIL BUSINESS_NAME OUTFILE")
EMAIL, BIZ, OUT = ARGS[0], ARGS[1], os.path.expanduser(ARGS[2])
BIZ_SQL = BIZ.replace("'", "''")
c = sb.creds()
BASE = "https://%s.supabase.co" % c["ref"]


def admin(method, path, body=None):
    return sb.call(method, path, body, c["service"], host=BASE)


def gen_pw():
    al = string.ascii_letters + string.digits + "!@#%^*-_=+"
    while True:
        p = "".join(secrets.choice(al) for _ in range(20))
        if (any(x.islower() for x in p) and any(x.isupper() for x in p)
                and any(x.isdigit() for x in p) and any(x in "!@#%^*-_=+" for x in p)):
            return p


st, out = admin("GET", "/auth/v1/admin/users?per_page=1000")
users = json.loads(out).get("users", [])
u = next((x for x in users if (x.get("email") or "").lower() == EMAIL.lower()), None)
if u:
    print("משתמש כבר קיים - לא משנה סיסמה")
    uid = u["id"]
else:
    pw = gen_pw()
    st, out = admin("POST", "/auth/v1/admin/users", {
        "email": EMAIL, "password": pw, "email_confirm": True,
        "user_metadata": {"must_change_pw": False, "app": "heshbonot"}})
    if st >= 300:
        print("HTTP", st, out[:200]); sys.exit(1)
    uid = json.loads(out)["id"]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write("email=%s password=%s\n" % (EMAIL, pw))
    print("נוצר משתמש; קובץ הסיסמה נכתב (%d תווים)" % len(pw))

st, out = sb.run_sql("select id from heshbonot.businesses where name = '%s'" % BIZ_SQL)
rows = json.loads(out)
if rows:
    bid = rows[0]["id"]
else:
    st, out = sb.run_sql("insert into heshbonot.businesses(name) values ('%s') returning id" % BIZ_SQL)
    bid = json.loads(out)[0]["id"]
sb.run_sql("insert into heshbonot.members(user_id, business_id, role) values ('%s','%s','owner') "
           "on conflict do nothing" % (uid, bid))
print("business", bid)
