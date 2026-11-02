import assert from "node:assert/strict";
import test from "node:test";
import { readRecipients, readResponse, renderMail } from "./credentials-mail.ts";

const HEAD = ["Kullanıcı Adı", "Parola", "E-posta", "Ad Soyad"];

test("the list is read by its column names", () => {
  const { recipients, errors } = readRecipients([HEAD, ["AYSE", "gizli,parola;123", "Ayse@Kurum.gov.tr", "Ayşe Şahin"], ["", "", "", ""], ["'-mehmet", "gizliparola123", "m@kurum.gov.tr"]]);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipients[0], { username: "ayse", password: "gizli,parola;123", email: "ayse@kurum.gov.tr", name: "Ayşe Şahin" });
  assert.equal(recipients[1].name, "");
  assert.equal(readRecipients([HEAD, ["ali", " gizliparola1 ", "a@k.tr"]]).recipients[0].password, " gizliparola1 ");
  assert.equal(recipients.length, 2);
});

test("a bad list is reported by line, and a repeated user isn't sent twice", () => {
  const { errors, warnings } = readRecipients([HEAD, ["ayse", "kisa", "a@b.co"], ["mehmet", "gizliparola123", "adres-degil"], ["ali", "gizliparola123", "o@k.tr"], ["ali", "gizliparola123", "o2@k.tr"], ["veli", "gizliparola123", "o@k.tr"]]);
  assert.match(errors[0], /^2\. satır \(ayse\): Parola en az 10/);
  assert.match(errors[1], /^3\. satır.*e-posta geçersiz/);
  assert.match(errors[2], /^5\. satır.*iki kez/);
  assert.match(warnings[0], /^6\. satır: o@k\.tr/);
  assert.match(readRecipients([["kullanici", "parola"]]).errors[0], /eposta/);
  assert.deepEqual(readRecipients([["kullanici", "parola", "eposta"]]).errors, ["Listede kimse yok."]);
});

test("the mail shows the details as text and fits in the address the API reads it from", () => {
  const html = renderMail({ username: "ayse", password: "a<b>&\"'c-123", name: "<b>Ayşe</b>" });
  assert.ok(html.includes("a&lt;b&gt;&amp;&quot;&#39;c-123"));
  assert.ok(html.includes("Sayın &lt;b&gt;Ayşe&lt;/b&gt;,"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("white-space:pre-wrap"));
  assert.ok(renderMail({ username: "a", password: "b", name: "" }).includes("Merhaba,"));
  assert.ok(new URLSearchParams({ templateContent: renderMail({ username: "u".repeat(32), password: "p".repeat(40), name: "İ".repeat(60) }) }).toString().length < 7000);
});

test("the provider's answers are read", () => {
  const sent = readResponse('<HERMES_RESPONSE><STATUS><CODE>0</CODE><NAME>NO_ERROR</NAME></STATUS><CONTENT><SEND_EMAIL_SUCCESS id="73732"><VALID_ADDRESS_COUNT>1</VALID_ADDRESS_COUNT></SEND_EMAIL_SUCCESS></CONTENT></HERMES_RESPONSE>');
  assert.deepEqual([sent.ok, sent.transactionId, sent.validAddresses], [true, "73732", 1]);
  assert.equal(readResponse('<CONTENT><AUTHORIZATION_WITH_TOKEN><TOKEN_NO>T1</TOKEN_NO></AUTHORIZATION_WITH_TOKEN></CONTENT>').token, "T1");
  assert.deepEqual(readResponse('<ORIGINATORS><ORIGINATOR id="657" service_id="5">Zafer</ORIGINATOR></ORIGINATORS>').originators, [{ id: "657", name: "Zafer" }]);
  assert.equal(readResponse("<STATUS><CODE>0</CODE></STATUS>").validAddresses, undefined);
  const failed = readResponse("<STATUS><CODE>12</CODE><NAME>ERR</NAME><DESC>Yetki yok</DESC></STATUS>");
  assert.deepEqual([failed.ok, failed.message], [false, "ERR - Yetki yok"]);
  assert.deepEqual([failed.understood, readResponse("<html>502</html>").ok, readResponse("<html>502</html>").understood], [true, false, false]);
});
