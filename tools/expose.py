import sys, json, io
sys.path.insert(0, "C:/projects/heshbonot/tools")
import sb
c = sb.creds()
st, out = sb.call("GET", "/v1/projects/%s/postgrest" % c["ref"], None, c["pat"])
d = json.loads(out)
io.open("C:/projects/heshbonot/_backups/postgrest-config-before.json", "w", encoding="utf-8").write(json.dumps(d, indent=1))
cur = [s.strip() for s in d["db_schema"].split(",")]
if "heshbonot" in cur:
    print("already exposed"); sys.exit(0)
new = ", ".join(cur + ["heshbonot"])
st, out = sb.call("PATCH", "/v1/projects/%s/postgrest" % c["ref"], {"db_schema": new}, c["pat"])
print(st, out[:200] if st >= 300 else "ok")
st, out = sb.call("GET", "/v1/projects/%s/postgrest" % c["ref"], None, c["pat"])
print(json.loads(out)["db_schema"])
