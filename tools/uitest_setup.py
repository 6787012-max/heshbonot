import json, os, sys, secrets, string, requests, urllib3
urllib3.disable_warnings()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sb
c = sb.creds(); BASE = "https://%s.supabase.co" % c["ref"]
if sys.argv[1] == "up":
    pw = "Ui1!" + "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(14))
    r = requests.post(BASE + "/auth/v1/admin/users", verify=False, headers={"apikey": c["service"], "Authorization": "Bearer " + c["service"], "User-Agent": "Mozilla/5.0"},
        json={"email": "zz-ui-test@example.com", "password": pw, "email_confirm": True, "user_metadata": {"must_change_pw": True}})
    uid = r.json()["id"]
    bid = sb.run_sql("insert into heshbonot.businesses(name,vat_number) values ('עסק בדיקת ממשק','514290185') returning id")[1]
    import re; bid = json.loads(bid)[0]["id"]
    sql = f"""insert into heshbonot.members values ('{uid}','{bid}','owner');
    insert into heshbonot.contacts(id,business_id,name,tax_id,phone) values ('11111111-1111-1111-1111-111111111111','{bid}','לקוח לדוגמה בע"מ','514290185','0501234567');
    insert into heshbonot.documents(business_id,doc_type,number,contact_id,customer_name,issue_date,due_date,vat_rate,subtotal,vat_amount,total,payment_status)
      values ('{bid}','tax_invoice',1,'11111111-1111-1111-1111-111111111111','לקוח לדוגמה בע"מ','2026-10-01','2026-10-31',18,1000,180,1180,'unpaid');
    insert into heshbonot.expenses(business_id,supplier_name,expense_date,category,amount_net,vat_amount) values ('{bid}','ספק לדוגמה',current_date,'משרד וציוד',100,18);"""
    print(sb.run_sql(sql)[0])
    json.dump({"uid": uid, "bid": bid, "pw": pw}, open("_backups/_ui.json", "w"))
    print("ok")
else:
    d = json.load(open("_backups/_ui.json"))
    t = ["document_items","document_payments","documents","contacts","expenses","bank_txns","doc_sequences","members"]
    sql = "set session_replication_role = replica; delete from heshbonot.audit_log where business_id='%s'; " % d["bid"] + "".join("delete from heshbonot.%s where business_id='%s'; " % (x, d["bid"]) for x in t) + "delete from heshbonot.businesses where id='%s'; delete from auth.users where id='%s';" % (d["bid"], d["uid"])
    print(sb.run_sql(sql)[0])
