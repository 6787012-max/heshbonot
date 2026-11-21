# -*- coding: utf-8 -*-
"""desec.py - רשומת CNAME לתת-דומיין heshbonot.mokad.co.il. הטוקן נקרא בזמן ריצה, לא מודפס."""
import io, json, os, re, sys, requests, urllib3
urllib3.disable_warnings()
t = io.open(os.path.join(os.path.expanduser("~"), ".secrets", "credentials-index.md"), encoding="utf-8").read()
m = re.search(r"deSEC API Token[^\n]*?`([A-Za-z0-9_\-]{20,})`", t)
if not m:
    sys.exit("טוקן deSEC לא נמצא")
H = {"Authorization": "Token " + m.group(1), "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
B = "https://desec.io/api/v1/domains/mokad.co.il/rrsets/"
cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
if cmd == "list":
    r = requests.get(B, headers=H, verify=False)
    print(r.status_code)
    for x in r.json():
        print(x["subname"] or "@", x["type"], x["ttl"], x["records"] if x["type"] in ("CNAME", "A") else "")
elif cmd == "add":
    body = [{"subname": "heshbonot", "type": "CNAME", "ttl": 3600, "records": ["6787012-max.github.io."]}]
    r = requests.post(B, headers=H, json=body, verify=False)
    print(r.status_code, r.text[:200] if r.status_code >= 300 else "ok")
