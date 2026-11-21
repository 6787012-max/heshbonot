import {amountInWords, validId, calcTotals} from "../js/il.js";
for (const v of [0.5, 1, 2, 3, 12, 21, 100, 123, 1000, 1234.56, 2360, 6500.01, 25000, 2000000]) console.log(v, amountInWords(v));
console.log(validId("514290185"), validId("123456789"), validId("000000018"));
console.log(calcTotals([{description:"a",qty:2,unit_price:1000}],18));
