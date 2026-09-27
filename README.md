# PAE - Backend API

API REST en Node.js y Express para el Programa de Alimentación Escolar (PAE), diseñada para gestionar reservas de minutas, asistencia, turnos de cocina, menús semanales, reportes de sobrantes y moderación de videojuegos educativos.

## Tecnologías

- **Node.js** (ES Modules)
- **Express.js**
- **Supabase** (PostgreSQL) con Service Role
- **JWT** (HMAC-SHA256) para autenticación basada en roles
- **Google Gemini API** para el chatbot informativo del PAE
- **Resend** para notificaciones por correo electrónico
- **xlsx** para exportación de reportes

## Requisitos

- Node.js 18 o superior
- Cuenta en Supabase con base de datos PostgreSQL

## Instalación

```bash
npm install
```

## Configuración de Entorno

Copia el archivo `.env.example` a `.env` y completa las variables de conexión:

```bash
cp .env.example .env
```

Las variables principales requeridas son:
- `PORT`: Puerto local (por defecto `4000`)
- `SUPABASE_URL`: URL del proyecto en Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Service role secret para acceso a la base de datos
- `ADMIN_CLAVE`: Secreto para firmar tokens JWT y acceso inicial de administrador
- `GEMINI_API_KEY`: Clave para el asistente virtual PAE
- `RESEND_API_KEY`: Clave de Resend para correos (opcional)

## Base de Datos

El script SQL completo con el esquema de tablas, funciones y políticas de seguridad se encuentra en `setup.sql`. Para aplicarlo:
1. Abre el panel de tu proyecto en Supabase.
2. Ve a **SQL Editor** ➔ **New Query**.
3. Pega el contenido de `setup.sql` y presiona **Run**.

Para poblar datos de prueba (beneficiarios, reservas, menús de ejemplo):
```bash
node scripts/sembrar-datos.cjs
node scripts/cargar-menu.cjs
```

## Ejecución

Desarrollo (con recarga automática):
```bash
npm run dev
```

Producción:
```bash
npm start
```

El servidor quedará disponible en `http://localhost:4000`.

## Pruebas

Para correr la suite de pruebas unitarias:
```bash
npm test
```

## Despliegue en Render

El repositorio incluye el archivo `render.yaml` listo para importar en Render como **Web Service**. Recuerda vincular las variables de entorno en el panel de Render.
