// Pruebas del hash de claves (scrypt): el login sigue validando
// contra el hash aunque el admin ahora tambien guarde la clave en
// texto plano para verla y editarla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashClave, verificarClave } from "../src/config/password.js";

test("hashClave devuelve el formato sal:hash", () => {
  const hash = hashClave("1234");
  assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
});

test("verificarClave acepta la clave correcta", () => {
  const hash = hashClave("8161");
  assert.equal(verificarClave("8161", hash), true);
});

test("verificarClave rechaza una clave incorrecta", () => {
  const hash = hashClave("8161");
  assert.equal(verificarClave("9999", hash), false);
});

test("cada hash es distinto aunque la clave sea la misma (sal aleatoria)", () => {
  assert.notEqual(hashClave("8161"), hashClave("8161"));
});

test("verificarClave devuelve false si el guardado no es valido", () => {
  assert.equal(verificarClave("8161", "texto-sin-formato"), false);
  assert.equal(verificarClave("8161", null), false);
  assert.equal(verificarClave("8161", ""), false);
});
