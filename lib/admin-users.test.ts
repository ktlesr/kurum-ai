import assert from "node:assert/strict";
import test from "node:test";
import { generatePassword, parseBulk } from "./admin-users.ts";
import { passwordProblem } from "./password.ts";

test("bulk user lines: separators, header, bad and repeated names", () => {
  const rows = parseBulk("kullanici;parola\nAli.Veli\r\nayse,gizliparola123\nmehmet\tgizli,parola;123\nali.veli\nçok kötü\nkisa,123\n\n");
  assert.deepEqual(rows, [
    { username: "ali.veli" },
    { username: "ayse", password: "gizliparola123" },
    { username: "mehmet", password: "gizli,parola;123" },
    { username: "ali.veli", error: "Listede iki kez var" },
    { username: "çok kötü", error: "Geçersiz kullanıcı adı" },
    { username: "kisa", error: "Parola en az 10 karakter olmalı." },
  ]);
  assert.deepEqual(parseBulk("kullanıcı adı, parola\nzeynep"), [{ username: "zeynep" }]);
  assert.deepEqual(parseBulk(""), []);
});

test("a generated password passes the rules and can't start a spreadsheet formula", () => {
  const p = generatePassword();
  assert.equal(passwordProblem(p), null);
  assert.match(p, /^k[0-9a-f]{18}$/);
});
