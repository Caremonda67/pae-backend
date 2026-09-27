const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Sembrador del menú: completa todas las semanas con 10 platos
// (Lunes-Viernes, Almuerzo + Refrigerio) en el API en producción.
// Uso:
//   node backend/scripts/cargar-menu.cjs
// Requiere el backend arriba y ADMIN_CLAVE/ADMIN_SECRET en backend/.env

const IMG = (id) => `https://images.unsplash.com/photo-${id}?w=400`;

const envPath = path.join(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const CLAVE = (env.match(/^ADMIN_CLAVE=(.*)$/m) || [])[1]?.trim();
const SECRETO = (env.match(/^ADMIN_SECRET=(.*)$/m) || [])[1]?.trim() || CLAVE;

if (!SECRETO) {
  console.error("Falta ADMIN_CLAVE/ADMIN_SECRET en backend/.env");
  process.exit(1);
}

// Token JWT HMAC igual que el backend (firma con ADMIN_SECRET o ADMIN_CLAVE)
const payload = { sub: "admin", rol: "admin", nombre: "Administrador", exp: Date.now() + 12 * 3600 * 1000 };
const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
const firma = crypto.createHmac("sha256", SECRETO).update(b64).digest("base64url");
const token = b64 + "." + firma;

const API = (env.match(/^API_URL=(.*)$/m) || [])[1]?.trim() || "https://pae-api-0s37.onrender.com";
const MENUS_URL = API.replace(/\/$/, "") + "/api/menus";

// Platillos a completar: semana 2 (3), semana 3 (10), semana 4 (9).
// Semana 1 ya está completa en la semilla base. Revisar que no se
// dupliquen días/jornadas ya existentes antes de re-ejecutar.
const platos = [
  // Semana 2 — huecos
  { semana: 2, dia: "Lunes", jornada: "Almuerzo", platillo: "Albóndigas en salsa con arroz", descripcion: "Albóndigas de carne en salsa de tomate, arroz blanco y frijol.", calorias: 510, imagen: IMG("1598515214211-89d3c73ae83b") },
  { semana: 2, dia: "Jueves", jornada: "Almuerzo", platillo: "Carne molida con arroz y frijoles", descripcion: "Carne molida guisada, arroz, frijoles y plátano maduro.", calorias: 540, imagen: IMG("1604908176997-125f25cc6f3d") },
  { semana: 2, dia: "Viernes", jornada: "Refrigerio", platillo: "Galletas integrales con jugo de naranja", descripcion: "Galletas integrales con jugo de naranja natural.", calorias: 280, imagen: IMG("1558961363-fa8fdf82db35") },

  // Semana 3 — completa
  { semana: 3, dia: "Lunes", jornada: "Almuerzo", platillo: "Sopa de lentejas con arroz", descripcion: "Lentejas guisadas con arroz y ensalada de remolacha.", calorias: 480, imagen: IMG("1547592166-23ac45744acd") },
  { semana: 3, dia: "Lunes", jornada: "Refrigerio", platillo: "Galletas de soda con jugo de guayaba", descripcion: "Galletas de soda con jugo de guayaba natural.", calorias: 320, imagen: IMG("1558961363-fa8fdf82db35") },
  { semana: 3, dia: "Martes", jornada: "Almuerzo", platillo: "Fideos con salsa boloñesa", descripcion: "Fideos con salsa de carne y queso rallado.", calorias: 500, imagen: IMG("1621996346565-e3dbc646d9a9") },
  { semana: 3, dia: "Martes", jornada: "Refrigerio", platillo: "Ponqué con avena", descripcion: "Ponqué casero con avena caliente.", calorias: 340, imagen: IMG("1517701550927-30cf4ba1dba5") },
  { semana: 3, dia: "Miercoles", jornada: "Almuerzo", platillo: "Carne sudada con arroz y papas", descripcion: "Carne sudada con papas criollas, arroz y ensalada fresca.", calorias: 530, imagen: IMG("1598515214211-89d3c73ae83b") },
  { semana: 3, dia: "Miercoles", jornada: "Refrigerio", platillo: "Fruta con yogurt", descripcion: "Porción de fruta variada con yogurt natural.", calorias: 290, imagen: IMG("1488477181946-6428a0291777") },
  { semana: 3, dia: "Jueves", jornada: "Almuerzo", platillo: "Mojarra frita con patacón", descripcion: "Mojarra frita con patacón, arroz y ensalada de aguacate.", calorias: 560, imagen: IMG("1580476262798-bddd9f4b7369") },
  { semana: 3, dia: "Jueves", jornada: "Refrigerio", platillo: "Banano con avena", descripcion: "Banano con avena y tostadas.", calorias: 300, imagen: IMG("1567306226416-28f0efdc88ce") },
  { semana: 3, dia: "Viernes", jornada: "Almuerzo", platillo: "Ajiaco con arroz", descripcion: "Ajiaco santafereño con pollo, papa y mazorca, acompañado de arroz.", calorias: 570, imagen: IMG("1603360946369-dc9bb6258143") },
  { semana: 3, dia: "Viernes", jornada: "Refrigerio", platillo: "Arepa con mantequilla y leche", descripcion: "Arepa caliente con mantequilla y un vaso de leche.", calorias: 330, imagen: IMG("1544787219-7f47ccb76574") },

  // Semana 4 — completa (ya existe el refrigerio de viernes)
  { semana: 4, dia: "Lunes", jornada: "Almuerzo", platillo: "Pasta con atún y ensalada", descripcion: "Pasta con atún, ensalada fresca y granos tiernos.", calorias: 470, imagen: IMG("1621996346565-e3dbc646d9a9") },
  { semana: 4, dia: "Lunes", jornada: "Refrigerio", platillo: "Cereal con leche", descripcion: "Cereal de maíz con leche y galleta.", calorias: 310, imagen: IMG("1558961363-fa8fdf82db35") },
  { semana: 4, dia: "Martes", jornada: "Almuerzo", platillo: "Cazuela de pollo con arroz", descripcion: "Cazuela de pollo con papas, zanahoria y arroz.", calorias: 520, imagen: IMG("1467003909585-2f8a72700288") },
  { semana: 4, dia: "Martes", jornada: "Refrigerio", platillo: "Galletas integrales con jugo de mango", descripcion: "Galletas integrales con jugo de mango natural.", calorias: 280, imagen: IMG("1482049016688-2d3e1b311543") },
  { semana: 4, dia: "Miercoles", jornada: "Almuerzo", platillo: "Arroz con verduras y pollo", descripcion: "Arroz con pollo, verduras salteadas y tomate.", calorias: 500, imagen: IMG("1596797038530-2c107229654b") },
  { semana: 4, dia: "Miercoles", jornada: "Refrigerio", platillo: "Pera con galleta", descripcion: "Pera picada con galleta integral.", calorias: 260, imagen: IMG("1567306226416-28f0efdc88ce") },
  { semana: 4, dia: "Jueves", jornada: "Almuerzo", platillo: "Bandeja con arroz, frijoles y huevo", descripcion: "Arroz, frijoles, huevo frito y plátano maduro.", calorias: 590, imagen: IMG("1604908176997-125f25cc6f3d") },
  { semana: 4, dia: "Jueves", jornada: "Refrigerio", platillo: "Leche con chocolate y pan", descripcion: "Chocolate caliente con pan.", calorias: 320, imagen: IMG("1544787219-7f47ccb76574") },
  { semana: 4, dia: "Viernes", jornada: "Almuerzo", platillo: "Arroz con carne desmechada", descripcion: "Carne desmechada guisada con arroz y ensalada.", calorias: 540, imagen: IMG("1598515214211-89d3c73ae83b") },
];

(async () => {
  let ok = 0, err = 0;
  for (const p of platos) {
    try {
      const res = await fetch(MENUS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(p),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok) {
        console.log(`ERROR S${p.semana} ${p.dia} ${p.jornada}: ${datos?.error || res.status}`);
        err++;
      } else {
        console.log(`OK S${p.semana} ${p.dia} ${p.jornada} -> #${datos.id} ${p.platillo}`);
        ok++;
      }
    } catch (e) {
      console.log(`FALLO ${p.platillo}: ${e.message}`);
      err++;
    }
  }
  console.log(`\nTotal: ${ok} ok, ${err} errores`);
})().catch((e) => { console.error(e); process.exit(1); });