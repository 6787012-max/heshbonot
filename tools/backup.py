# -*- coding: utf-8 -*-
"""backup.py - מייצא את כל טבלאות schema heshbonot ל-JSON מוצפן (AES-GCM).
המפתח נוצר אוטומטית ב-~/.secrets/heshbonot-backup.key (לא מודפס, מחוץ לריפו).
יעד: Y:/offload-from-D/heshbonot-backups/ אם Y זמין, אחרת _backups/ בפרויקט.
שחזור/בדיקה:  python tools/backup.py --verify <קובץ>
"""
import base64, datetime, io, json, os, secrets, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import sb

KEYFILE = os.path.join(os.path.expanduser("~"), ".secrets", "heshbonot-backup.key")
TABLES = ["businesses", "members", "doc_sequences", "contacts", "documents", "document_items",
          "document_payments", "expenses", "bank_txns", "audit_log"]


def key():
    if not os.path.exists(KEYFILE):
        os.makedirs(os.path.dirname(KEYFILE), exist_ok=True)
        io.open(KEYFILE, "w").write(base64.b64encode(secrets.token_bytes(32)).decode())
    return base64.b64decode(io.open(KEYFILE).read().strip())


def dest_dir():
    y = "Y:/offload-from-D/heshbonot-backups"
    try:
        if os.path.isdir("Y:/"):
            os.makedirs(y, exist_ok=True)
            return y
    except OSError:
        pass
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_backups")
    os.makedirs(d, exist_ok=True)
    return d


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--verify":
        raw = open(sys.argv[2], "rb").read()
        data = json.loads(AESGCM(key()).decrypt(raw[:12], raw[12:], b"heshbonot"))
        print({k: len(v) for k, v in data["tables"].items()})
        return 0
    out = {"exported_at": datetime.datetime.now().isoformat(), "tables": {}}
    for t in TABLES:
        st, body = sb.run_sql("select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as j from heshbonot.%s x" % t)
        if st >= 300:
            print("שגיאה בטבלה", t, st); return 1
        out["tables"][t] = json.loads(body)[0]["j"]
        if isinstance(out["tables"][t], str):
            out["tables"][t] = json.loads(out["tables"][t])
    nonce = secrets.token_bytes(12)
    blob = nonce + AESGCM(key()).encrypt(nonce, json.dumps(out, ensure_ascii=False).encode("utf-8"), b"heshbonot")
    path = os.path.join(dest_dir(), "heshbonot-%s.json.enc" % datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    open(path, "wb").write(blob)
    print("נשמר:", path, "| גודל", len(blob), "| שורות:", {k: len(v) for k, v in out["tables"].items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
