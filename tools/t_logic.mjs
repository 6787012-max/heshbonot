import fs from "node:fs";
import {decodeBytes, parseCSV, findHeaderRow, guessMapping, normalizeRows} from "../js/bankparse.js";
import {suggestMatches} from "../js/match.js";
import {buildUniform, encode8859_8, LEN} from "../js/uniform.js";
import {makeZip, crc32} from "../js/zip.js";
let fail = 0; const ok = (n, c, i="") => { console.log((c?"PASS ":"FAIL ")+n+(i?" | "+i:"")); if(!c) fail++; };
const {text, enc} = decodeBytes(fs.readFileSync("samples/bank-hapoalim-cp1255.csv"));
ok("זיהוי windows-1255", enc === "windows-1255" && text.includes("העברה"), enc);
const rows = parseCSV(text); const hi = findHeaderRow(rows);
ok("שורת כותרת נמצאה (אחרי שורת כותרת-דוח)", hi === 1, hi);
const map = guessMapping(rows[hi]);
ok("מיפוי עמודות אוטומטי", map.date===0 && map.desc===2 && map.debit===4 && map.credit===5 && map.balance===6, JSON.stringify(map));
const {txns, skipped} = await normalizeRows(rows.slice(hi+1), map);
ok("5 תנועות", txns.length === 5, txns.length);
ok("סכום עם פסיק 1,250.50", txns[1].debit === 1250.5);
ok("שתי תנועות זהות מקבלות hash שונה", txns[2].hash !== txns[3].hash);
const again = await normalizeRows(rows.slice(hi+1), map);
ok("hash יציב בין הרצות (מניעת כפילות)", again.txns[0].hash === txns[0].hash);
const docs = [
 {id:"d1", doc_type:"tax_invoice", status:"issued", customer_name:"לקוח בדיקה בע\"מ", total:590, paid_amount:0, issue_date:"2026-11-05", payment_status:"unpaid"},
 {id:"d2", doc_type:"tax_invoice", status:"issued", customer_name:"אחר", total:590, paid_amount:0, issue_date:"2026-10-01", payment_status:"unpaid"},
 {id:"d3", doc_type:"receipt", status:"issued", customer_name:"משה כהן", total:100, paid_amount:0, issue_date:"2026-11-17", payment_status:"n/a"}];
const exps = [{id:"e1", supplier_name:"חברת החשמל", total:1250.5, expense_date:"2026-11-10"}];
const m = suggestMatches(txns, docs, exps);
const byTxn = (d) => m.find(x => x.txn.description.includes(d));
ok("זכות 590 מותאמת לחשבונית של הלקוח (לא לאחרת)", byTxn("לקוח בדיקה")?.id === "d1", byTxn("לקוח בדיקה")?.score);
ok("זכות 100 מותאמת לקבלה של משה כהן", byTxn("משה כהן")?.id === "d3", byTxn("משה כהן")?.score);
ok("חובה מותאמת להוצאה", byTxn("חשמל")?.id === "e1" && byTxn("חשמל").type === "expense", byTxn("חשמל")?.score);
// מבנה אחיד
const biz = {name:"עסק בדיקה", vat_number:"514290185", address:"רחוב 1"};
const D = [
 {id:"a", doc_type:"tax_invoice", number:1, issue_date:"2026-11-05", customer_name:"לקוח בדיקה", customer_tax_id:"514290185", subtotal:2000, vat_amount:360, total:2360, vat_rate:18, status:"issued", customer_address:"תל אביב"},
 {id:"b", doc_type:"receipt", number:1, issue_date:"2026-11-10", customer_name:"לקוח בדיקה", customer_tax_id:"", subtotal:2360, vat_amount:0, total:2360, vat_rate:18, status:"issued"}];
const I = [{document_id:"a", line_no:1, description:"שירות א", qty:2, unit_price:1000, discount_pct:0, line_total:2000},{document_id:"b", line_no:1, description:"תשלום", qty:1, unit_price:2360, discount_pct:0, line_total:2360}];
const P = [{document_id:"b", method:"check", amount:2360, check_no:"4455", check_date:"2026-11-10"}];
const u = buildUniform({business:biz, docs:D, items:I, payments:P, from:"2026-11-01", to:"2026-11-30"});
const lines = u.bkmv.split("\r\n").filter(Boolean);
const bad = lines.filter(l => LEN[l.slice(0,4)] !== l.length);
ok("כל שורות BKMVDATA באורך לפי המפרט", bad.length === 0, lines.map(l=>l.slice(0,4)+":"+l.length).join(" "));
ok("רצף רשומות A100..Z900", lines[0].startsWith("A100") && lines.at(-1).startsWith("Z900") && lines.length === u.records);
ok("INI.TXT: A000 באורך 466 + ספירות", u.ini.split("\r\n")[0].length === 466 && u.ini.includes("C100000000000000002"), u.ini.split("\r\n").map(l=>l.length).join(","));
const bin = encode8859_8(u.bkmv);
ok("קידוד 8859-8 (עברית 0xE0-0xFA)", bin.includes(0xe9) && bin.length === u.bkmv.length);
const z = makeZip([{name:"INI.TXT", data: encode8859_8(u.ini)},{name:"BKMVDATA.TXT", data: bin}]);
fs.writeFileSync("_backups/test.zip", z);
ok("ZIP נוצר, חתימה PK", z[0]===0x50 && z[1]===0x4b, z.length);
console.log(fail ? "נכשלו "+fail : "הכול עבר");
