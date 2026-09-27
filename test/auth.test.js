import { test } from "node:test";
import assert from "node:assert/strict";
import { firmarToken, verificarToken, requiereRol } from "../src/config/auth.js";

const datos = { usuario: "admin", rol: "admin", nombre: "Administrador" };

test("firmarToken genera un token con dos partes", () => {
  const token = firmarToken(datos);
  assert.equal(token.split(".").length, 2);
});

test("verificarToken acepta un token recien firmado", () => {
  const token = firmarToken(datos);
  const payload = verificarToken(token);
  assert.equal(payload.rol, "admin");
  assert.equal(payload.sub, "admin");
  assert.equal(payload.nombre, "Administrador");
  assert.ok(payload.exp > Date.now());
});

test("verificarToken rechaza un token manipulado", () => {
  const token = firmarToken(datos);
  const [base64, firma] = token.split(".");
  // Alteramos el payload y dejamos la firma original
  const manipulado = `${base64}x.${firma}`;
  assert.equal(verificarToken(manipulado), null);
});

test("verificarToken rechaza tokens vacios o mal formados", () => {
  assert.equal(verificarToken(""), null);
  assert.equal(verificarToken("sin-puntos"), null);
  assert.equal(verificarToken(undefined), null);
});

test("verificarToken rechaza un token expirado", () => {
  // Fabricamos un token con expiracion ya vencida
  const payload = Buffer.from(
    JSON.stringify({ sub: "admin", exp: Date.now() - 1000 })
  ).toString("base64url");
  const expirado = `${payload}.firma-invalida`;
  // La firma es invalida y ademas esta expirado: debe rechazarse
  assert.equal(verificarToken(expirado), null);
});

test("requiereRol deja pasar al rol permitido y bloquea al que no", async () => {
  const tokenCocina = firmarToken({ usuario: "chef", rol: "cocina", nombre: "Chef" });
  const tokenEstudiante = firmarToken({ usuario: "123", rol: "estudiante", nombre: "Ana" });

  const permiso = requiereRol("admin", "cocina");

  // El rol cocina SI puede pasar
  let paso = false;
  const reqOk = { headers: { authorization: `Bearer ${tokenCocina}` } };
  const resOk = { status() { return this; }, json() { return this; } };
  permiso(reqOk, resOk, () => { paso = true; });
  assert.equal(paso, true);
  assert.equal(reqOk.usuario.rol, "cocina");

  // El rol estudiante NO puede pasar: responde 403
  const res403 = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
  permiso({ headers: { authorization: `Bearer ${tokenEstudiante}` } }, res403, () => {});
  assert.equal(res403.code, 403);

  // Sin token: responde 401
  const res401 = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
  permiso({ headers: {} }, res401, () => {});
  assert.equal(res401.code, 401);
});
