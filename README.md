# SGC · Sistema de Gestión de Solicitudes de Compras y Pedidos

Conecta las solicitudes de los vendedores con el equipo de compras, consultando
existencias reales del ERP (**Quiter**) y dejando bitácora de cada movimiento.

**Stack:** Node.js + Express + **SQL Server** (T-SQL con `mssql`) · React (Vite) +
Tailwind CSS + lucide-react + Axios · Autenticación JWT con bcrypt y permisos por rol.

---

## 1. Cómo se ve

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

## 2. Instalación para probar en tu computadora

Se necesitan dos cosas instaladas. Ninguna cuesta nada.

### 2.1 Node.js

Descarga la versión **LTS** de <https://nodejs.org> y ejecuta el instalador con
todas las opciones por defecto. Al terminar, **cierra y vuelve a abrir**
PowerShell y comprueba:

```powershell
node --version
```

Debe responder `v20...` o superior.

### 2.2 SQL Server Express

Es el mismo motor de base de datos que usa el servidor, en su versión gratuita.
Descárgalo de <https://www.microsoft.com/sql-server/sql-server-downloads>,
recuadro **Express**, e instala con la opción **Basic**.

### 2.3 Dejarlo configurado

SQL Server Express se instala **sin TCP/IP y solo con autenticación de Windows**,
así que tal cual queda, la aplicación no puede conectarse. En vez de diez pasos
entre el Configuration Manager y SSMS, hay un script que lo deja listo.

Abre **Windows PowerShell como administrador** y, desde la carpeta del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File database\configurar-sqlserver-local.ps1
```

Enciende TCP/IP en el puerto 1433, habilita el modo mixto, crea la base
`SGC_COMPRAS` y un usuario con permiso **únicamente sobre ella**, escribe el
`.env` con una contraseña y una llave JWT aleatorias, y prueba la conexión.
La contraseña la genera el script: nadie la teclea ni aparece en pantalla.

### 2.4 Arrancar

En una terminal **normal** (sin administrador):

```powershell
cd backend
npm install
npm run db:setup
npm run dev
```

Y en otra ventana:

```powershell
cd frontend
npm install
npm run dev
```

Abre <http://localhost:5173> y entra con cualquiera de estos usuarios
(contraseña **`demo1234`** para todos):

| Correo | Rol | Qué ve |
|---|---|---|
| `vendedor@demo.mx` | Vendedor | Buscador de existencias y sus solicitudes |
| `comprador@demo.mx` | Comprador | Mesa de trabajo + dashboard |
| `gerente@demo.mx` | Gerente | Todo |

---

## 3. Pruebas automáticas

```powershell
cd backend
npm test
```

Corre tres suites:

| Suite | Qué revisa | ¿Necesita base de datos? |
|---|---|---|
| `npm run test:erp` | El adaptador de Quiter: la consulta de existencias y el mapeo de resultados | No |
| `npm run test:sql` | El SQL que emite la app: que no haya valores concatenados, que sea T-SQL y que solo escriba en las tablas propias | No |
| `npm run smoke` | El flujo completo contra la base: alta, permisos por rol, transiciones y dashboard | Sí |

Además, `python3 database/validar-tsql.py` (requiere `pip install sqlglot`)
revisa que los scripts del esquema sean T-SQL válido antes de tocar la base.

---

## 4. Estructura del proyecto

```
sgc-compras/
├── database/
│   ├── 01_schema.sql          # tablas, PK, FK, índices, secuencia y vista (T-SQL)
│   ├── 02_seed.sql            # datos de prueba
│   └── validar-tsql.py        # revisa la sintaxis del esquema sin servidor
│
├── backend/
│   ├── .env.example
│   ├── scripts/
│   │   ├── setupDb.js         # aplica los .sql por lotes (npm run db:setup)
│   │   ├── smokeTest.js       # prueba end-to-end de la API (npm run smoke)
│   │   ├── testErpSql.js      # pruebas del adaptador de Quiter (npm run test:erp)
│   │   └── validarSql.js      # revisa el SQL emitido (npm run test:sql)
│   └── src/
│       ├── server.js          # punto de entrada
│       ├── app.js             # construcción de la app Express
│       ├── config/
│       │   ├── env.js         # única lectura de process.env
│       │   └── db.js          # pool de SQL Server + transacciones + modo ensayo
│       ├── middleware/
│       │   ├── auth.js        # JWT + permitirRoles()
│       │   └── errorHandler.js
│       ├── routes/            # un archivo por módulo
│       ├── controllers/       # validan entrada y responden
│       ├── services/
│       │   ├── solicitudes.service.js   # TODO el SQL del sistema vive aquí
│       │   └── erp/
│       │       ├── index.js             # fachada: elige el origen de datos
│       │       ├── quiterClient.js      # API interna de refacciones
│       │       ├── sqlServerClient.js   # SQL Server de Quiter (solo lectura)
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
│           ├── Login.jsx  VendedorPage.jsx  ComprasPage.jsx  DashboardPage.jsx
│
└── docker-compose.yml         # SQL Server local en Linux/Mac (opcional)
```

---

## 5. Modelo de datos

Las tablas viven en su **propia base** (`SGC_COMPRAS`), en el mismo servidor
donde está Quiter. Mismo respaldo y misma administración, pero sin ninguna
posibilidad de tocar el esquema del ERP: **a Quiter solo se le lee**.

```
sucursales ──┐
             ├──< usuarios ──< solicitudes_compras ──< solicitudes_detalle
clientes ────┘                        │
                                      └──< solicitud_historial >── usuarios
```

| Tabla | Para qué sirve |
|---|---|
| `sucursales` | Agencias. `clave` es la clave de ALMACÉN en Quiter. |
| `clientes` | Cliente al que se le promete el material (`codigo_erp`). |
| `usuarios` | Acceso al sistema. `rol` ∈ Vendedor / Comprador / Gerente. |
| `solicitudes_compras` | Encabezado: folio, prioridad, estatus, promesa de entrega. |
| `solicitudes_detalle` | Partidas. Guarda la **existencia real al momento de solicitar**. |
| `solicitud_historial` | Bitácora: quién movió qué, cuándo y con qué comentario. |

Detalles que vale la pena conocer:

- **Folio automático** `SC-2026-000001`, armado por una secuencia en el DEFAULT
  de la columna. No depende de la aplicación y no se puede repetir aunque dos
  vendedores capturen al mismo tiempo.
- **Índices** para los filtros reales de la operación: por vendedor, sucursal,
  estatus, prioridad, fecha y el compuesto `(estatus_actual, prioridad)` que usa
  la Mesa de Trabajo.
- `CHECK` en `rol`, `prioridad` y `estatus_actual`: la base rechaza valores que
  no existen en el flujo.
- `ON DELETE CASCADE` en detalle e historial; sin cascada donde borrar rompería
  la trazabilidad.
- El cambio de estatus usa `WITH (UPDLOCK, ROWLOCK)`: dos compradores no pueden
  pisarse el mismo folio.

### Flujo de estatus

```
Pendiente ──► En Cotizacion ──► Autorizada ──► En Transito ──► Recibido
     │              │                │              │
     └──────────────┴────────────────┴──────────────┴──► Cancelada / Rechazada
```

Las transiciones válidas están en un solo lugar (`backend/src/utils/estatus.js`)
y el frontend las consume, así que la interfaz solo ofrece pasos legales y la
API rechaza cualquier otro con **409**.

---

## 6. API

Todos los endpoints van bajo `/api` y (salvo `login`, `health` y `meta`)
requieren el header `Authorization: Bearer <token>`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| `GET` | `/health` | — | Estado de la base y de la integración con Quiter. |
| `GET` | `/meta` | — | Estatus, prioridades y transiciones válidas. |
| `POST` | `/auth/login` | — | Devuelve JWT + datos del usuario. |
| `GET` | `/auth/yo` | todos | Perfil del token (revalidación al recargar). |
| `GET` | `/productos/existencias?sku=XXX&almacen=101` | todos | **Consulta al ERP.** `sku` acepta código o texto parcial. |
| `POST` | `/solicitudes` | Vendedor, Gerente | Crea encabezado + partidas + primer historial, en **una transacción**. |
| `GET` | `/solicitudes` | todos | Filtros: `id_vendedor`, `prioridad`, `estatus`, `sucursal`, `desde`, `hasta`, `busqueda`, `limite`, `pagina`. |
| `GET` | `/solicitudes/:id` | todos | Encabezado + partidas + bitácora + siguientes estatus posibles. |
| `PATCH` | `/solicitudes/:id/estatus` | Comprador, Gerente | Cambia estatus, fija promesa de entrega y guarda comentario. |
| `GET` | `/dashboard/gerencia?dias=30&sucursal=1` | Comprador, Gerente | KPIs, distribución por estatus, top de faltantes y tiempo de atención. |
| `GET` | `/catalogos/sucursales` · `/catalogos/clientes?q=` | todos | Para los selects del frontend. |

Reglas de negocio que impone la API, no solo la interfaz:

- Un **Vendedor** solo ve sus propias solicitudes, aunque mande otro
  `id_vendedor` en la query.
- Un **Vendedor** no puede mover estatus (**403**).
- Pasar a **En Transito** exige `fecha_promesa_entrega` (**400** si falta).
- Solo se aceptan transiciones válidas del flujo (**409** en cualquier otro caso).
- Al llegar a un estatus final se sella `fecha_cierre`, que alimenta el KPI de
  tiempo promedio de atención.

---

## 7. De dónde salen las existencias

El sistema puede leer el inventario de Quiter por dos caminos. La fachada
`src/services/erp/index.js` elige solo, en este orden:

**1. SQL Server de Quiter** (si están las variables `ERPSQL_*`) — consulta
directa con un usuario de **solo lectura**. Es el camino con más control.

**2. API interna de refacciones** (si está `QUITER_BASE_URL`) — usa el endpoint
`GET /api/existencias` de `catosa-api`, que devuelve la existencia desglosada
por almacén. **No requiere credenciales nuevas**: ese servidor ya habla con
Quiter. Es la forma más simple de arrancar.

**3. Catálogo simulado** — si no hay nada configurado. El sistema funciona y lo
advierte en pantalla, para poder capacitar sin tocar el ERP.

Si el origen activo falla, no se cae la operación del vendedor: responde con el
catálogo local y marca `origen: "MOCK_FALLBACK"` con un aviso visible.

### 7.1 Usuario de solo lectura (para el camino 1)

Pedirle esto a quien administra el servidor de Quiter. El sistema **solo
necesita leer una tabla**:

```sql
CREATE LOGIN sgc_compras_ro WITH PASSWORD = 'UNA-CONTRASENA-LARGA-Y-UNICA';

USE [NOMBRE_DE_LA_BASE_DE_QUITER];
CREATE USER sgc_compras_ro FOR LOGIN sgc_compras_ro;

-- Permiso mínimo: leer el inventario de refacciones. Nada más.
GRANT SELECT ON dbo.FTIGBI_PR TO sgc_compras_ro;
```

Aunque alguien comprometiera este sistema, no podría modificar ni borrar nada en
Quiter: el usuario no tiene con qué. No usar `sa` ni una cuenta de administrador.

### 7.2 De dónde sale cada dato

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

### 7.3 Dos errores a NO repetir

El adaptador evita dos fallas reales que tumbaron el buscador de la app de
Ventas. `npm run test:erp` las verifica como pruebas de regresión:

1. **Comparar `ALMACEN` contra un número.** La columna es texto y contiene
   valores como `'102LA'`; escribir `WHERE ALMACEN = 101` obliga a SQL Server a
   convertir cada renglón a entero y la consulta truena con *"Conversion failed
   when converting the varchar value '102LA' to data type int"*.

2. **Olvidar los paréntesis del `OR`.** En `AND a LIKE @b OR c LIKE @b`, el
   `AND` tiene precedencia y la búsqueda por descripción se escapa del filtro de
   almacén, trayendo renglones de toda la empresa.

Y un tercero, propio de estos datos: **Quiter trae renglones repetidos** del
mismo artículo en el mismo almacén. Hay que sumarlos, no listarlos por separado.

---

## 8. Pendientes para producción

- [ ] Cambiar `JWT_SECRET` por una cadena larga y aleatoria.
- [ ] Sustituir los usuarios de demo por los reales.
- [ ] Crear la base `SGC_COMPRAS` en el servidor y apuntar el `.env` ahí.
- [ ] Notificación al vendedor cuando su solicitud cambia de estatus.
- [ ] Exportar a Excel la Mesa de Trabajo y el top de faltantes.
- [ ] Adjuntar cotizaciones del proveedor a la solicitud.
- [ ] HTTPS y `CORS_ORIGIN` apuntando solo al dominio real.

---

## 9. Despliegue en el servidor

El sistema se publica igual que `catosa-api`: **corriendo en el servidor Windows
de la empresa y expuesto por el mismo túnel de Cloudflare**. No va en Railway ni
en un servicio en la nube, porque Quiter vive en la red interna y desde afuera
no hay cómo alcanzarlo.

La diferencia con las demás apps: aquélla son HTML sueltos que GitHub Pages
sirve tal cual, y ésta es React, que hay que compilar. Por eso **el mismo Node
sirve la API y la interfaz**: un solo despliegue, un solo dominio, sin CORS.

### 9.1 Preparar la aplicación

```powershell
cd backend
npm install
npm run build:interfaz     # compila el frontend a frontend/dist
npm start
```

Al arrancar, la consola dice si encontró la interfaz compilada. Si la ve, todo
—pantallas y datos— sale por el mismo puerto.

### 9.2 Publicarla por el túnel de Cloudflare

En el archivo de configuración de `cloudflared` (el mismo que ya publica
`api.catosaapps.lat`) se agrega una entrada más en `ingress`:

```yaml
ingress:
  - hostname: api.catosaapps.lat
    service: http://localhost:3000        # catosa-api, como está hoy
  - hostname: compras.catosaapps.lat      # ← el sistema de Compras
    service: http://localhost:4000
  - service: http_status:404              # esta va siempre al final
```

Y se crea el registro DNS:

```powershell
cloudflared tunnel route dns <nombre-del-tunel> compras.catosaapps.lat
```

Un mismo túnel puede publicar todos los servicios que quieras; no hace falta
levantar otro.

### 9.3 Que siga corriendo al reiniciar

Node no se queda como servicio por sí solo. Usa **el mismo mecanismo con el que
ya se mantiene `catosa-api`** — lo importante es que sea uno solo para las dos,
para no tener que acordarse de dos formas distintas. Las opciones habituales son
NSSM (`nssm install SGC-Compras`), una tarea programada al inicio del sistema
con *"Ejecutar aunque el usuario no haya iniciado sesión"*, o PM2.

### 9.4 El `.env` de producción

Cambia respecto al de pruebas:

```env
NODE_ENV=production
CORS_ORIGIN=https://compras.catosaapps.lat
DB_HOST=<servidor de SQL Server>
DB_DATABASE=SGC_COMPRAS
DB_USER=<usuario con permiso solo sobre esa base>
DB_PASSWORD="<contraseña entre comillas>"
JWT_SECRET="<cadena larga y aleatoria, distinta a la de pruebas>"
```

La base `SGC_COMPRAS` se crea en el mismo SQL Server donde está Quiter, pero es
una base **aparte**: mismo respaldo y misma administración, sin posibilidad de
tocar el esquema del ERP.

> **Las contraseñas van entre comillas en el `.env`.** Sin ellas, un `#` en la
> contraseña se interpreta como inicio de comentario y el valor llega cortado;
> el error que aparece es *"Login failed for user"*, que no da ninguna pista.

---

## 10. Subir cambios a GitHub

El repositorio es **https://github.com/AMHER-MX/sistema-solicitudes-compras** (privado).

```powershell
git add -A
git commit -m "describe aquí el cambio"
git push
```

`.gitignore` ya excluye `node_modules/`, los archivos `.env` y los builds, así
que **no se suben credenciales**. Los `.env.example` sí se suben: son la
plantilla para que cada persona arme su propio `.env`.
