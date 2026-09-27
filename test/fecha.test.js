// Pruebas de la validacion de fecha de las reservas
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarFecha } from "../src/routes/reservas.js";

// Fecha YYYY-MM-DD del proximo dia de la semana (0=domingo, 6=sabado)
function proximoDia(diaSemana) {
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  let diferencia = (diaSemana - hoy.getDay() + 7) % 7;
  if (diferencia === 0) diferencia = 7;
  const f = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + diferencia);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

test("validarFecha rechaza los fines de semana", () => {
  assert.match(validarFecha(proximoDia(6)), /sábados y domingos/i);
  assert.match(validarFecha(proximoDia(0)), /sábados y domingos/i);
});

test("validarFecha acepta un dia habil dentro del rango", () => {
  assert.equal(validarFecha(proximoDia(1)), null);
});
