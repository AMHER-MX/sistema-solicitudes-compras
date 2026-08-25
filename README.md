# SGC · Sistema de Gestión de Solicitudes de Compras y Pedidos

Conecta las solicitudes de los vendedores con el equipo de compras, consultando
existencias en el ERP (**Quiter**) y dejando bitácora de cada movimiento.

**Stack:** Node.js + Express + PostgreSQL (SQL nativo con `pg`) · React (Vite) +
Tailwind CSS + lucide-react + Axios · Autenticación JWT con bcrypt y permisos por rol.

---

## 1. Arranque rápido (5 minutos)

Necesitas **Node.js 20+** y **PostgreSQL 14+** (o Docker).

```bash
# 1. Base de datos ────────────────────────────────────────────────
#    Opción A: con Docker (no instalas nada)
docker compose up -d

#    Opción B: con tu PostgreSQL local
createdb sgc_compras

# 2. Backend ──────────────────────────────────────────────────────
cd backend
cp .env.example .env          # ajusta PGUSER / PGPASSWORD si hace falta
npm install
npm run db:setup              # crea tablas + datos de prueba
npm run dev                   # API en http://localhost:4000

# 3. Frontend (en otra terminal) ──────────────────────────────────
cd frontend
npm install
npm run dev                   # app en http://localhost:5173
```

Abre <http://localhost:5173> y entra con cualquiera de estos usuarios
(contraseña **`demo1234`** para todos):

| Correo | Rol | Qué ve |
|---|---|---|
| `vendedor@demo.mx` | Vendedor | Buscador de existencias y sus solicitudes |
| `comprador@demo.mx` | Comprador | Mesa de trabajo + dashboard |
| `gerente@demo.mx` | Gerente | Todo |

> `npm test` (dentro de `/backend`) ejecuta las pruebas automáticas: el adaptador
> del ERP y el recorrido completo del flujo contra la base de datos.

---

## 2. Cómo se ve

**Vista Vendedor** — busca la parte, ve la existencia del ERP y, si sale en cero,
levanta la solicitud sin cambiar de pantalla.

![Vista Vendedor](docs/capturas/01-vendedor.png)

**Mesa de Trabajo de Compras** — bandeja filtrable por urgencia, estatus y sucursal.

![Mesa de Compras](docs/capturas/02-mesa-compras.png)

**Dashboard Gerencial** — KPIs, artículos que más se piden sin existencia y carga por sucursal.

![Dashboard](docs/capturas/03-dashboard.png)

**Detalle y bitácora** — cada movimiento queda registrado con usuario, fecha y comentario.

![Detalle](docs/capturas/04-detalle-bitacora.png)

---

## 3. Estructura del proyecto

```
sgc-compras/
├── database/
│   ├── 01_schema.sql          # tablas, PK, FK, índices, triggers y vista
│   └── 02_seed.sql            # datos de prueba (usuarios, clientes, solicitudes)
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── scripts/
│   │   ├── setupDb.js         # aplica los .sql (npm run db:setup)
│   │   ├── smokeTest.js       # prueba end-to-end de la API (npm run smoke)
│   │   └── testErpSql.js      # pruebas del adaptador de Quiter (npm run test:erp)
│   └── src/
│       ├── server.js          # punto de entrada
│       ├── app.js             # construcción de la app Express
│       ├── config/
│       │   ├── env.js         # única lectura de process.env
│       │   └── db.js          # pool de PostgreSQL + transacciones
│       ├── middleware/
│       │   ├── auth.js        # JWT + permitirRoles()
│       │   └── errorHandler.js
│       ├── routes/            # un archivo por módulo
│       ├── controllers/       # validan entrada y responden
│       ├── services/
│       │   ├── solicitudes.service.js   # TODO el SQL vive aquí
│       │   └── erp/
│       │       ├── index.js             # fachada: elige el origen de datos
│       │       ├── sqlServerClient.js   # ← SQL Server de Quiter (producción)
│       │       ├── quiterClient.js      # API REST de Quiter (si algún día existe)
│       │       └── catalogoMock.js      # catálogo simulado de respaldo
│       └── utils/
│           ├── estatus.js     # máquina de estados del flujo
│           └── errors.js
│
├── frontend/
│   ├── vite.config.js         # proxy /api -> localhost:4000
│   └── src/
│       ├── main.jsx  App.jsx  index.css   # tokens de color y modo oscuro
│       ├── api/client.js                  # Axios + JWT + manejo de 401
│       ├── context/AuthContext.jsx        # sesión y rol
│       ├── lib/constantes.js              # estatus, badges y formateadores
│       ├── components/
│       │   ├── Layout.jsx
│       │   ├── BuscadorExistencias.jsx    # consulta al ERP en tiempo real
│       │   ├── FormularioSolicitud.jsx
│       │   ├── PanelSeguimiento.jsx       # modal de cambio de estatus
│       │   ├── DetalleSolicitudModal.jsx  # partidas + bitácora
│       │   └── ui/
│       │       ├── Primitivos.jsx         # botones, campos, badges, modal
│       │       └── Graficos.jsx           # KPIs y barras horizontales
│       └── pages/
│           ├── Login.jsx
│           ├── VendedorPage.jsx
│           ├── ComprasPage.jsx
│           └── DashboardPage.jsx
│
└── docker-compose.yml         # PostgreSQL local (opcional)
```

---

## 4. Modelo de datos

```
sucursales ──┐
             ├──< usuarios ──< solicitudes_compras ──< solicitudes_detalle
clientes ────┘                        │
                                      └──< solicitud_historial >── usuarios
```

| Tabla | Para qué sirve |
|---|---|
| `sucursales` | Catálogo de agencias; `clave` es la que usa Quiter como almacén. |
| `clientes` | Cliente final al que se le promete el material (`codigo_erp`). |
| `usuarios` | Acceso al sistema. `rol` ∈ Vendedor / Comprador / Gerente. |
| `solicitudes_compras` | Encabezado: folio, prioridad, estatus, promesa de entrega. |
| `solicitudes_detalle` | Partidas. Guarda la **existencia real al momento de solicitar** (foto del ERP). |
| `solicitud_historial` | Bitácora: quién movió qué, cuándo y con qué comentario. |

Detalles de implementación:

- **Folio automático** `SC-2026-000001` mediante secuencia + trigger
  (`fn_generar_folio`), así nunca se repite ni depende de la aplicación.
- **Índices** para los filtros reales de la operación: por vendedor, sucursal,
  estatus, prioridad, fecha y el compuesto `(estatus_actual, prioridad)` que usa
  la Mesa de Trabajo.
- `CHECK` en `rol`, `prioridad` y `estatus_actual`: la base rechaza valores que
  no existen en el flujo.
- `ON DELETE CASCADE` en detalle e historial; `RESTRICT` donde borrar rompería
  la trazabilidad.
- Vista `vw_solicitudes_resumen` con partidas, monto y horas de atención ya
  calculadas.

### Flujo de estatus

```
Pendiente ──► En Cotizacion ──► Autorizada ──► En Transito ──► Recibido
     │              │                │              │
     └──────────────┴────────────────┴──────────────┴──► Cancelada / Rechazada
```

Las transiciones válidas están en un solo lugar (`backend/src/utils/estatus.js`) y
el frontend las consume, así que la interfaz solo ofrece pasos legales y la API
rechaza cualquier otro con **409**.

---

## 5. API

Todos los endpoints van bajo `/api` y (salvo `login`, `health` y `meta`)
requieren el header `Authorization: Bearer <token>`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| `GET` | `/health` | — | Estado de la BD y de la integración con Quiter. |
| `GET` | `/meta` | — | Estatus, prioridades y transiciones válidas. |
| `POST` | `/auth/login` | — | Devuelve JWT + datos del usuario. |
| `GET` | `/auth/yo` | todos | Perfil del token (revalidación al recargar). |
| `GET` | `/productos/existencias?sku=XXX&almacen=101` | todos | **Consulta al ERP.** `sku` acepta código o texto parcial. |
| `POST` | `/solicitudes` | Vendedor, Gerente | Crea encabezado + partidas + primer historial (`Pendiente`) en **una transacción**. |
| `GET` | `/solicitudes` | todos | Filtros: `id_vendedor`, `prioridad`, `estatus`, `sucursal`, `desde`, `hasta`, `busqueda`, `limite`, `pagina`. |
| `GET` | `/solicitudes/:id` | todos | Encabezado + partidas + bitácora + siguientes estatus posibles. |
| `PATCH` | `/solicitudes/:id/estatus` | Comprador, Gerente | Cambia estatus, fija `fecha_promesa_entrega`, guarda comentario en historial. |
| `GET` | `/dashboard/gerencia?dias=30&sucursal=1` | Comprador, Gerente | KPIs, distribución por estatus, top de faltantes y tiempo promedio de atención. |
| `GET` | `/catalogos/sucursales` · `/catalogos/clientes?q=` | todos | Para los selects del frontend. |

Reglas de negocio que la API impone (no solo la interfaz):

- Un **Vendedor** solo puede ver sus propias solicitudes, aunque mande otro
  `id_vendedor` en la query.
- Un **Vendedor** no puede mover estatus (**403**).
- Pasar a **En Transito** exige `fecha_promesa_entrega` (**400** si falta).
- Solo se aceptan transiciones válidas del flujo (**409** en cualquier otro caso).
- Al llegar a un estatus final se sella `fecha_cierre`, que alimenta el KPI de
  tiempo promedio de atención.
- El cambio de estatus usa `SELECT ... FOR UPDATE`: dos compradores no pueden
  pisarse el mismo folio.

Ejemplos:

```bash
# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"vendedor@demo.mx","password":"demo1234"}'

# Existencias
curl 'http://localhost:4000/api/productos/existencias?sku=BAL-8890' \
  -H "Authorization: Bearer $TOKEN"

# Crear solicitud
curl -X POST http://localhost:4000/api/solicitudes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "id_cliente": 1,
        "prioridad": "Urgente",
        "observaciones": "Unidad varada en taller.",
        "items": [
          { "sku_producto": "BAL-8890",
            "descripcion": "Balata delantera cerámica 8890",
            "cantidad_solicitada": 4,
            "precio_estimado": 1250 }
        ]
      }'

# Dar seguimiento
curl -X PATCH http://localhost:4000/api/solicitudes/1/estatus \
  -H "Authorization: Bearer $TOKEN_COMPRADOR" -H 'Content-Type: application/json' \
  -d '{"estatus":"En Transito","fecha_promesa_entrega":"2026-09-15","comentario":"OC-4410 colocada."}'
```

---

## 6. Conexión con Quiter

El sistema lee las existencias **directamente de la base de datos SQL Server de
Quiter**, igual que la app de Ventas de refacciones (`catosa-api`). No hay una
API intermedia: menos piezas que se puedan caer y menos superficie expuesta.

Mientras no se configure la conexión, el sistema responde con un **catálogo
simulado** y lo advierte en pantalla (`"origen": "MOCK"`), así se puede operar y
capacitar desde el día uno.

### 6.1 Crear el usuario de solo lectura

Este es el paso de seguridad importante, y hay que pedírselo a quien administra
el servidor de Quiter. El sistema **solo necesita leer una tabla**:

```sql
-- Ejecutar en el SQL Server de Quiter, una sola vez.
CREATE LOGIN sgc_compras_ro WITH PASSWORD = 'UNA-CONTRASENA-LARGA-Y-UNICA';

USE [NOMBRE_DE_LA_BASE_DE_QUITER];
CREATE USER sgc_compras_ro FOR LOGIN sgc_compras_ro;

-- Permiso mínimo: leer el inventario de refacciones. Nada más.
GRANT SELECT ON dbo.FTIGBI_PR TO sgc_compras_ro;
```

Con eso, aunque alguien comprometiera este sistema, **no podría modificar ni
borrar nada en Quiter**: el usuario no tiene con qué. No uses `sa` ni una cuenta
de administrador "porque es más rápido" — es la diferencia entre un susto y una
pérdida de datos.

### 6.2 Configurar el `.env`

```env
ERPSQL_HOST=servidor-quiter.interno
ERPSQL_PORT=1433
ERPSQL_DATABASE=nombre_de_la_base
ERPSQL_USER=sgc_compras_ro
ERPSQL_PASSWORD=la-contrasena-del-paso-anterior
ERPSQL_ENCRYPT=true
ERPSQL_TRUST_CERT=true
ERPSQL_ALMACENES=101,102,101LA,102LA
ERP_ALMACEN_DEFAULT=101
```

Verifica con `GET /api/health`: debe responder `"origen": "SQLSERVER"` y
`"conectado": true`.

### 6.3 De dónde sale cada dato

| Campo del sistema | Origen en Quiter |
|---|---|
| `sku_producto` | `FTIGBI_PR.ARTICULO` |
| `descripcion` | `FTIGBI_PR.DES_ARTICULO` |
| `existencia_real_almacen` | `FTIGBI_PR.EXIS_REALES` |
| `precio_estimado` | `FTIGBI_PR.COSTO_MEDIO` |
| `ubicacion` | `FTIGBI_PR.UBICACION` |
| `sucursales.clave` | `FTIGBI_PR.ALMACEN` |

Los almacenes salen de las columnas `ALMACEN` y `NOM_ALMACEN` de la propia tabla:

| Clave | Sucursal | | Clave | No es sucursal de venta |
|---|---|---|---|---|
| `101` | Torreón | | `102LA` | Consigna Lala |
| `102` | Gómez Palacio | | `104CU` | Cores usados Piedras Negras |
| `103` | Monclova | | `201RE` | Rescates 24 horas Durango |
| `104` | Piedras Negras | | | |
| `201` | Durango | | | |
| `202` | Poniente | | | |
| `203` | Zacatecas | | | |

Los tres de la derecha quedan fuera de `ERPSQL_ALMACENES` a propósito: no son
puntos de venta y contarlos inflaría la existencia disponible.

### 6.4 Dos errores a NO repetir

El adaptador (`src/services/erp/sqlServerClient.js`) evita dos fallas reales que
tumbaron el buscador de la app de Ventas. `npm run test:erp` las verifica como
pruebas de regresión:

1. **Comparar `ALMACEN` contra un número.** La columna es texto y contiene
   valores como `'102LA'`; escribir `WHERE ALMACEN = 101` obliga a SQL Server a
   convertir cada renglón a entero y la consulta truena con
   *"Conversion failed when converting the varchar value '102LA' to data type int"*.
   Va siempre entre comillas.

2. **Olvidar los paréntesis del `OR`.** En `AND a LIKE @b OR c LIKE @b`, el `AND`
   tiene precedencia y la búsqueda por descripción se escapa del filtro de
   almacén, trayendo renglones de toda la empresa. Los paréntesis no son
   opcionales.

### 6.5 Si algún día Quiter publica una API REST

El adaptador `src/services/erp/quiterClient.js` ya está listo para ese caso: se
llena `QUITER_BASE_URL` en el `.env` y se ajusta el mapeo de campos. La fachada
`src/services/erp/index.js` elige el origen automáticamente, con este orden de
preferencia: **SQL Server → API HTTP → catálogo simulado**. Si el origen activo
falla, no se cae la operación: responde con el catálogo local y marca
`origen: "MOCK_FALLBACK"` para que el vendedor lo vea.

## 7. Pendientes para producción

Esta es la primera versión funcional. Antes de liberarla conviene:

- [ ] Cambiar `JWT_SECRET` por una cadena larga y aleatoria, y no subir `.env` al repo.
- [ ] Crear el usuario de solo lectura en SQL Server y conectar Quiter (sección 6).
- [ ] Confirmar qué clave de almacén corresponde a cada sucursal (sección 6.3).
- [ ] Sustituir los usuarios de demo por los reales (o integrar el directorio de la empresa).
- [ ] Notificación al vendedor cuando su solicitud cambia de estatus (correo o WhatsApp).
- [ ] Exportar a Excel la Mesa de Trabajo y el top de faltantes.
- [ ] Adjuntar cotizaciones del proveedor a la solicitud.
- [ ] Respaldo automático de la base de datos.
- [ ] HTTPS y `CORS_ORIGIN` apuntando solo al dominio real.

---

## 8. Subir el proyecto a GitHub

El repositorio ya existe y es privado:
**https://github.com/AMHER-MX/sistema-solicitudes-compras**

Este proyecto ya trae su commit inicial hecho, así que solo falta conectarlo y
empujarlo. Desde la carpeta del proyecto:

```bash
cd sgc-compras
git remote add origin https://github.com/AMHER-MX/sistema-solicitudes-compras.git
git branch -M main
git push -u origin main
```

Cuando git pida contraseña, GitHub **no acepta la de la cuenta**: hay que usar un
token de acceso personal (o instalar [GitHub CLI](https://cli.github.com) y correr
`gh auth login` una sola vez, que deja la autenticación resuelta para siempre).

`.gitignore` ya excluye `node_modules/`, los archivos `.env` y los builds, así que
**no se suben credenciales**. Los archivos `.env.example` sí se suben: son la
plantilla para que cada persona arme su propio `.env`.
