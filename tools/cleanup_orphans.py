import sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import sb
tbs=("document_items","document_payments","documents","contacts","expenses","bank_txns","doc_sequences","members")
sql="set session_replication_role = replica; "+"".join("delete from heshbonot.%s where business_id not in (select id from heshbonot.businesses); "%t for t in tbs)+"delete from heshbonot.audit_log where business_id is not null and business_id not in (select id from heshbonot.businesses);"
print(sb.run_sql(sql)[0])
print(sb.run_sql("select (select count(*) from heshbonot.documents) d,(select count(*) from heshbonot.businesses) b,(select count(*) from heshbonot.contacts) c,(select count(*) from heshbonot.audit_log) a")[1])
