import sys, json
sys.path.insert(0, "C:/projects/heshbonot/tools")
import sb
c = sb.creds()
st, out = sb.call("GET", "/v1/projects/%s/postgrest" % c["ref"], None, c["pat"])
print(st)
try:
    d = json.loads(out); print({k: d[k] for k in ("db_schema","db_extra_search_path","max_rows") if k in d})
except Exception: print(out[:300])
print("anon len", len(c["anon"]), "svc len", len(c["service"]))
