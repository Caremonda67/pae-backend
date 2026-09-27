const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const crypto = require("crypto");

const envPath = path.join(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const SUPABASE_URL = env.match(/^SUPABASE_URL=(.*)$/m)?.[1]?.trim();
const KEY = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();

const BASE = `${SUPABASE_URL}/rest/v1`;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(clave), sal, 64).toString("hex");
  return `${sal}:${hash}`;
}

async function get(tabla, select = "*") {
  const r = await fetch(`${BASE}/${tabla}?select=${select}`, { headers });
  if (!r.ok) throw new Error(`get ${tabla} ` + (await r.text()));
  return r.json();
}

async function run() {
  console.log("Leyendo Excel...");
  const wb = xlsx.readFile("D:/descargas/Lista-Estudiantes.xls");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(ws);

  const beneficiarios = data.map(r => {
    let grado = String(r.Grado);
    if (r.Grupo) {
      const match = String(r.Grupo).match(/(\d+)$/);
      if (match) {
        grado = `${grado}-${match[1]}`;
      } else {
        grado = `${grado}-${r.Grupo}`;
      }
    }
    
    return {
      documento: String(r.Documento),
      nombre: String(r["Apellidos y nombre del estudiante"]),
      sede: String(r.Sede),
      turno: "Almuerzo",
      grado: grado
    };
  });

  console.log(`Leidos ${beneficiarios.length} estudiantes del Excel.`);

  const [bens, users] = await Promise.all([
    get("beneficiarios", "documento"),
    get("usuarios", "usuario"),
  ]);
  const docsExistentes = new Set(bens.map((b) => b.documento));
  const usersExistentes = new Set(users.map((u) => u.usuario));

  const nuevos = beneficiarios.filter((b) => !docsExistentes.has(b.documento));
  if (nuevos.length) {
    const r = await fetch(`${BASE}/beneficiarios`, { method: "POST", headers, body: JSON.stringify(nuevos) });
    if (!r.ok) throw new Error("insert beneficiarios " + r.status + " " + (await r.text()));
    console.log(`? ${nuevos.length} beneficiarios creados`);
  } else {
    console.log("?? No hay beneficiarios nuevos");
  }

  const cuentas = [];
  for (const b of beneficiarios) {
    if (!usersExistentes.has(b.documento)) {
      cuentas.push({ 
        nombre: b.nombre, 
        usuario: b.documento, 
        clave_hash: hashClave("1234"), 
        rol: "estudiante" 
      });
    }
  }

  if (cuentas.length) {
    const r = await fetch(`${BASE}/usuarios`, { method: "POST", headers, body: JSON.stringify(cuentas) });
    if (!r.ok) throw new Error("insert estudiantes " + r.status + " " + (await r.text()));
    console.log(`? ${cuentas.length} cuentas de estudiante creadas con PIN 1234`);
  } else {
    console.log("?? No hay cuentas de estudiante nuevas por crear");
  }
}

run().catch(console.error);
