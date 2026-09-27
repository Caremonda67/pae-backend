// Pruebas de los mensajes de confirmacion de reserva
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechalegible,
  armarMensajeEmail,
  armarMensajeEmailHtml,
} from "../src/routes/reservas.js";

test("fechalegible convierte YYYY-MM-DD a un formato en espanol", () => {
  const resultado = fechalegible("2026-08-08");
  assert.match(resultado, /sábado/i);
  assert.match(resultado, /8/);
  assert.match(resultado, /agosto/i);
});

test("fechalegible funciona con dia de un solo digito", () => {
  const resultado = fechalegible("2026-03-03");
  assert.match(resultado, /3/);
  assert.match(resultado, /marzo/i);
});

test("armarMensajeEmail incluye nombre, fecha, turno y sede", () => {
  const mensaje = armarMensajeEmail("Ana Pérez", "2026-08-08", "Almuerzo", "Sede A");
  assert.match(mensaje, /Ana Pérez/);
  assert.match(mensaje, /Almuerzo/);
  assert.match(mensaje, /Sede A/);
  assert.match(mensaje, /agosto/i);
  assert.match(mensaje, /desperdicio/i);
});

test("armarMensajeEmailHtml genera HTML con los datos", () => {
  const html = armarMensajeEmailHtml("Ana Pérez", "2026-08-08", "Almuerzo", "Sede A");
  assert.match(html, /<div/);
  assert.match(html, /Ana Pérez/);
  assert.match(html, /Almuerzo/);
  assert.match(html, /Sede A/);
});
