const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Siembra de datos de demostración para el programa de
// alimentación escolar: beneficiarios, cuentas, reservas y
// asistencias realistas. Idempotente.
//
// Uso:
//   node backend/scripts/sembrar-datos.cjs
// Requiere backend/.env con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.

const envPath = path.join(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const URL = env.match(/^SUPABASE_URL=(.*)$/m)?.[1]?.trim();
const KEY = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();

if (!URL || !KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en backend/.env");
  process.exit(1);
}

const BASE = URL.replace(/\/$/, "") + "/rest/v1";
const headers = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

const SEDE_P = "Institución Educativa Ciudad Cordoba Sede principal";
const SEDE_E = "Institución Educativa Ciudad Cordoba Sede Enrique Olaya Herrera";

function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(clave), sal, 64).toString("hex");
  return `${sal}:${hash}`;
}

// ------------------- Beneficiarios -------------------
const beneficiarios = [
  { documento: "1001", nombre: "Luisa Fernanda Pérez",   sede: SEDE_P, turno: "Almuerzo",   grado: "10-2" },
  { documento: "1002", nombre: "Carlos Andrés Ramírez",  sede: SEDE_P, turno: "Almuerzo",   grado: "10-2" },
  { documento: "1003", nombre: "Valentina Morales",      sede: SEDE_P, turno: "Almuerzo",   grado: "10-2" },
  { documento: "1004", nombre: "Sebastián Torres",       sede: SEDE_P, turno: "Almuerzo",   grado: "10-2" },
  { documento: "1005", nombre: "Ana María Giraldo",      sede: SEDE_P, turno: "Almuerzo",   grado: "11-1" },
  { documento: "1006", nombre: "Daniela Restrepo",       sede: SEDE_P, turno: "Almuerzo",   grado: "11-1" },
  { documento: "1007", nombre: "Juan Pablo Cifuentes",   sede: SEDE_P, turno: "Almuerzo",   grado: "11-1" },
  { documento: "1008", nombre: "Sara Vanegas",           sede: SEDE_P, turno: "Almuerzo",   grado: "11-2" },
  { documento: "1009", nombre: "Felipe Ospina",          sede: SEDE_P, turno: "Almuerzo",   grado: "11-2" },
  { documento: "1010", nombre: "María Camila Rendón",    sede: SEDE_E, turno: "Almuerzo",   grado: "11-2" },
  { documento: "1011", nombre: "Andrés Felipe Gómez",    sede: SEDE_E, turno: "Almuerzo",   grado: "11-2" },
  { documento: "1012", nombre: "Laura Sofía Duarte",     sede: SEDE_E, turno: "Almuerzo",   grado: "11-2" },
  { documento: "1013", nombre: "Nicolás Patiño",         sede: SEDE_E, turno: "Almuerzo",   grado: "11-2" },
  { documento: "1014", nombre: "Isabella Cuartas",       sede: SEDE_E, turno: "Refrigerio", grado: "10-1" },
  { documento: "1015", nombre: "Samuel Bedoya",          sede: SEDE_E, turno: "Almuerzo",   grado: "10-1" },
  { documento: "1016", nombre: "Gabriela Londoño",       sede: SEDE_E, turno: "Almuerzo",   grado: "10-1" },
];

// ------------------- Reservas (hoy, mañana y próxima semana) -------------------
// Las fechas fijas son del año 2026; ajustar si se re-siembra en otro curso.
const reservas = [
  // Jueves 2026-08-27
  { documento: "1112", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1010", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1011", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1012", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1013", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1111", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1001", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1002", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1003", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1004", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1111", fecha: "2026-08-27", turno: "Refrigerio" },
  { documento: "1002", fecha: "2026-08-27", turno: "Refrigerio" },
  { documento: "1008", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1009", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1005", fecha: "2026-08-27", turno: "Almuerzo" },
  { documento: "1007", fecha: "2026-08-27", turno: "Almuerzo" },
  // Viernes 2026-08-28
  { documento: "1010", fecha: "2026-08-28", turno: "Almuerzo" },
  { documento: "1012", fecha: "2026-08-28", turno: "Almuerzo" },
  { documento: "1112", fecha: "2026-08-28", turno: "Almuerzo" },
  { documento: "1111", fecha: "2026-08-28", turno: "Almuerzo" },
  { documento: "1001", fecha: "2026-08-28", turno: "Almuerzo" },
  { documento: "1003", fecha: "2026-08-28", turno: "Almuerzo" },
  { documento: "1001", fecha: "2026-08-28", turno: "Refrigerio" },
  { documento: "1004", fecha: "2026-08-28", turno: "Refrigerio" },
  { documento: "1005", fecha: "2026-08-28", turno: "Almuerzo" },
  { documento: "1008", fecha: "2026-08-28", turno: "Almuerzo" },
  // Lunes 2026-08-31
  { documento: "1111", fecha: "2026-08-31", turno: "Almuerzo" },
  { documento: "1002", fecha: "2026-08-31", turno: "Almuerzo" },
  { documento: "1004", fecha: "2026-08-31", turno: "Almuerzo" },
  { documento: "1011", fecha: "2026-08-31", turno: "Almuerzo" },
  { documento: "1013", fecha: "2026-08-31", turno: "Almuerzo" },
  // Martes 2026-09-01
  { documento: "1111", fecha: "2026-09-01", turno: "Almuerzo" },
  { documento: "1004", fecha: "2026-09-01", turno: "Almuerzo" },
  { documento: "1010", fecha: "2026-09-01", turno: "Almuerzo" },
];

// Asistencia en fechas pasadas, llave documento|fecha|turno -> asistio.
// Solo aplica si esas reservas existen (base actual del curso).
const asistPast = {
  "1111|2026-08-11|Almuerzo": true,
  "1111|2026-08-11|Refrigerio": true,
  "1111|2026-08-12|Almuerzo": true,
  "1111|2026-08-12|Refrigerio": false,
  "1112|2026-08-12|Almuerzo": true,
  "1111|2026-08-13|Almuerzo": true,
  "1111|2026-08-14|Almuerzo": false,
  "1111|2026-08-17|Almuerzo": true,
  "1110296351|2026-08-25|Almuerzo": true,
};

const get = async (tabla, select) => {
  const r = await fetch(`${BASE}/${tabla}?select=${encodeURIComponent(select)}`, { headers });
  if (!r.ok) throw new Error(`${tabla} GET ${r.status}`);
  return r.json();
};

(async () => {
  console.log("— Leyendo datos actuales…");
  const [bens, users] = await Promise.all([
    get("beneficiarios", "documento"),
    get("usuarios", "usuario"),
  ]);
  const docsExistentes = new Set(bens.map((b) => b.documento));
  const usersExistentes = new Set(users.map((u) => u.usuario));

  // 1. Beneficiarios nuevos
  const nuevos = beneficiarios.filter((b) => !docsExistentes.has(b.documento));
  if (nuevos.length) {
    const r = await fetch(`${BASE}/beneficiarios`, { method: "POST", headers, body: JSON.stringify(nuevos) });
    if (!r.ok) throw new Error("insert beneficiarios " + r.status + " " + (await r.text()));
    console.log(`✓ ${nuevos.length} beneficiarios creados`);
  } else {
    console.log("· No hay beneficiarios nuevos");
  }

  // 2. Cuentas de estudiante (PIN 1234) + profesora Laura
  const todos = await get("beneficiarios", "documento,nombre,sede,grado");
  const nombreDe = (doc) => (todos.find((b) => b.documento === doc) || {}).nombre || doc;

  const cuentas = [];
  const profesores = [];
  for (const b of beneficiarios) {
    if (!usersExistentes.has(b.documento)) {
      cuentas.push({ nombre: b.nombre, usuario: b.documento, clave_hash: hashClave("1234"), rol: "estudiante" });
    }
  }
  if (!usersExistentes.has("Laura")) {
    profesores.push({ nombre: "Laura Gutiérrez", usuario: "Laura", clave_hash: hashClave("1234"), rol: "profesor", sede: SEDE_P, turno: "Almuerzo", grado: "10-2" });
  }
  if (cuentas.length) {
    const r = await fetch(`${BASE}/usuarios`, { method: "POST", headers, body: JSON.stringify(cuentas) });
    if (!r.ok) throw new Error("insert estudiantes " + r.status + " " + (await r.text()));
    console.log(`✓ ${cuentas.length} cuentas de estudiante creadas (PIN 1234)`);
  } else {
    console.log("· No hay cuentas de estudiante nuevas");
  }
  if (profesores.length) {
    const r = await fetch(`${BASE}/usuarios`, { method: "POST", headers, body: JSON.stringify(profesores) });
    if (!r.ok) throw new Error("insert profesor " + r.status + " " + (await r.text()));
    console.log("✓ profesora Laura creada (grupo Sede principal / Almuerzo / 10-2, PIN 1234)");
  } else {
    console.log("· La profesora Laura ya existía");
  }

  // 3. Reservas nuevas (evitando duplicados doc/fecha/turno)
  const existentes = await get("reservas", "id,documento,fecha,turno");
  const claveDe = (r) => `${r.documento}|${r.fecha}|${r.turno}`;
  const usadas = new Set(existentes.map(claveDe));
  const nuevasReservas = [];
  for (const r of reservas) {
    const c = claveDe(r);
    if (usadas.has(c)) continue;
    usadas.add(c);
    nuevasReservas.push({
      estudiante: nombreDe(r.documento),
      documento: r.documento,
      sede: (todos.find((b) => b.documento === r.documento) || {}).sede,
      grado: (todos.find((b) => b.documento === r.documento) || {}).grado || null,
      turno: r.turno,
      fecha: r.fecha,
      asistio: false,
    });
  }
  if (nuevasReservas.length) {
    const r = await fetch(`${BASE}/reservas`, { method: "POST", headers, body: JSON.stringify(nuevasReservas) });
    if (!r.ok) throw new Error("insert reservas " + r.status + " " + (await r.text()));
    console.log(`✓ ${nuevasReservas.length} reservas creadas`);
  } else {
    console.log("· No hay reservas nuevas");
  }

  // 4. Asistencia realista en fechas pasadas
  let actualizadas = 0;
  for (const [clave, asistio] of Object.entries(asistPast)) {
    const [documento, fecha, turno] = clave.split("|");
    const r = await fetch(
      `${BASE}/reservas?documento=eq.${encodeURIComponent(documento)}&fecha=eq.${fecha}&turno=eq.${encodeURIComponent(turno)}`,
      { method: "PATCH", headers, body: JSON.stringify({ asistio }) }
    );
    if (!r.ok) {
      console.log(`· (aviso) no se pudo actualizar ${clave}: ${r.status}`);
      continue;
    }
    actualizadas++;
  }
  console.log(`✓ ${actualizadas} asistencias de fechas pasadas actualizadas`);

  // 5. Borrar reservas cuya documento no existe como beneficiario
  const todasRes = await get("reservas", "id,documento");
  let borradas = 0;
  for (const r of todasRes) {
    if (!docsExistentes.has(r.documento)) {
      await fetch(`${BASE}/reservas?id=eq.${r.id}`, { method: "DELETE", headers });
      borradas++;
    }
  }
  if (borradas) console.log(`✓ ${borradas} reservas huérfanas borradas`);
  else console.log("· No hay reservas huérfanas");

  console.log("\nListo.");
})().catch((e) => { console.error("FALLO:", e.message); process.exit(1); });