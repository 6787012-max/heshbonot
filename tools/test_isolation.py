# -*- coding: utf-8 -*-
"""בדיקת בידוד בין עסקים: מרים רואה רק את העסק שלה, יוסף רק את שלו. מאפס must_change_pw אצל יוסף.
סיסמאות נקראות מקבצים ב-~/.secrets ולא מודפסות."""
import io, json, os, re, sys
import urllib3, requests
urllib3.disable_warnings()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sb

c = sb.creds()
BASE = "https://%s.supabase.co" % c["ref"]
UA = {"User-Agent": "Mozilla/5.0"}
SEC = os.path.join(os.path.expanduser("~"), ".secrets")
Y_EMAIL, M_EMAIL = "6742853+heshbonot@gmail.com", "6742853+miriam@gmail.com"
res = []


def check(n, ok, info=""):
    res.append(ok)
    print(("PASS " if ok else "FAIL ") + n + (" | " + str(info)[:120] if info else ""))


def creds_from(fn):
    t = io.open(os.path.join(SEC, fn), encoding="utf-8").read()
    return re.search(r"password=(\S+)", t).group(1)


def login(email, pw):
    r = requests.post(BASE + "/auth/v1/token?grant_type=password", verify=False, headers={**UA, "apikey": c["anon"]},
                      json={"email": email, "password": pw})
    return r.json().get("access_token")


def get(tok, path):
    return requests.get(BASE + "/rest/v1/" + path, verify=False,
                        headers={**UA, "apikey": c["anon"], "Authorization": "Bearer " + tok, "Accept-Profile": "heshbonot"})


# איפוס must_change_pw אצל יוסף
st, out = sb.call("GET", "/auth/v1/admin/users?per_page=1000", None, c["service"], host=BASE)
users = json.loads(out)["users"]
yu = next(u for u in users if (u.get("email") or "").lower() == Y_EMAIL)
st, out = sb.call("PUT", "/auth/v1/admin/users/" + yu["id"], {"user_metadata": {"must_change_pw": False}}, c["service"], host=BASE)
check("must_change_pw של יוסף אופס", st < 300 and json.loads(out)["user_metadata"].get("must_change_pw") is False, st)

st, out = sb.run_sql("select b.id, b.name, (select string_agg(u.email||':'||m.role, ',') from heshbonot.members m join auth.users u on u.id=m.user_id where m.business_id=b.id) mem from heshbonot.businesses b order by b.created_at")
biz = json.loads(out)
for b in biz:
    print("עסק:", b["name"], "| חברים:", b["mem"])
mb = next(b for b in biz if b["name"] == "העסק של מרים")
yb = next(b for b in biz if b["name"] == "העסק של יוסף")
check("מרים חברה רק בעסק שלה (owner)", mb["mem"] == M_EMAIL + ":owner" and M_EMAIL not in (yb["mem"] or ""), mb["mem"])

mt = login(M_EMAIL, creds_from("heshbonot-miriam.txt"))
check("מרים נכנסת עם סיסמה", bool(mt))
if mt:
    r = get(mt, "businesses?select=id,name")
    check("מרים רואה רק את העסק שלה", [x["id"] for x in r.json()] == [mb["id"]], r.text[:100])
    for tb in ("contacts", "documents", "expenses", "bank_txns", "doc_sequences", "audit_log"):
        r = get(mt, tb + "?select=business_id&business_id=eq." + yb["id"])
        check("מרים: אפס שורות של יוסף ב-%s" % tb, r.status_code == 200 and r.json() == [], r.text[:80])
    r = get(mt, "members?select=business_id")
    check("מרים רואה רק את החברות שלה", [x["business_id"] for x in r.json()] == [mb["id"]], r.text[:100])

try:
    yt = login(Y_EMAIL, creds_from("heshbonot-initial.txt"))
except Exception:
    yt = None
if yt:
    r = get(yt, "businesses?select=id")
    check("יוסף רואה רק את העסק שלו", [x["id"] for x in r.json()] == [yb["id"]], r.text[:100])
    r = get(yt, "documents?select=id&business_id=eq." + mb["id"])
    check("יוסף: אפס שורות מהעסק של מרים", r.json() == [], r.text[:80])
else:
    print("NOTE: הסיסמה הראשונית של יוסף כבר לא תקפה (הוחלפה); הבידוד שלו נבדק רק דרך members")
    st, out = sb.run_sql("select count(*) n from heshbonot.members where user_id='%s' and business_id='%s'" % (yu["id"], mb["id"]))
    check("יוסף אינו חבר בעסק של מרים", json.loads(out)[0]["n"] == 0)
print("סה\"כ %d, נכשלו %d" % (len(res), res.count(False)))
