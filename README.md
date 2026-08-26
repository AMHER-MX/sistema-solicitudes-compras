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

Corre cuatro suites:

| Suite | Qué revisa | ¿Necesita base de datos? |
|---|---|---|
| `npm run test:erp` | El adaptador de Quiter: la consulta de existencias y el mapeo de resultados | No |
| `npm run test:usuarios` | Contraseñas y seguros de la administración de cuentas: que la temporal sea sólida, que nadie se quede fuera del sistema | No |
| `npm run test:sql` | El SQL que emite la app: que no haya valores concatenados, que sea T-SQL y que solo escriba en las tablas propias | No |
| `npm run smoke` | El flujo completo contra la base: alta, permisos por rol, transiciones y dashboard | Sí |

`npm run db:estado` no es una prueba, pero sirve para lo mismo: dice en una
línea si la base está alcanzable, si tiene el esquema y cuántos datos hay.

Además, `python3 database/validar-tsql.py` (requiere `pip install sqlglot`)
revisa que los scripts del esquema sean T-SQL válido antes de tocar la base.

---

## 4. Estructura del proyecto

```
sgc-compras/
├── database/
│   ├── 01_schema.sql          # tablas, PK, FK, índices, secuencia y vista (T-SQL)
│   ├── 02_seed.sql            # datos de prueba
│   ├── 03_migracion_usuarios.sql  # columnas de administración de cuentas
│   └── validar-tsql.py        # revisa la sintaxis de todos los .sql, sin servidor
│
├── scripts/
│   └── desplegar-servidor.ps1 # despliegue completo en el servidor (§ 10.1)
│
├── backend/
│   ├── .env.example
│   ├── scripts/
│   │   ├── setupDb.js         # instala de cero: BORRA y recrea (npm run db:setup)
│   │   ├── migrarDb.js        # agrega lo que falta, sin borrar (npm run db:migrar)
│   │   ├── estadoDb.js        # diagnóstico de la base en JSON (npm run db:estado)
│   │   ├── lib/sqlLotes.js    # parte los .sql por GO y los aplica
│   │   ├── smokeTest.js       # prueba end-to-end de la API (npm run smoke)
│   │   ├── testErpSql.js      # pruebas del adaptador de Quiter (npm run test:erp)
│   │   ├── testUsuarios.js    # contraseñas y seguros (npm run test:usuarios)
│   │   └── validarSql.js      # revisa el SQL emitido (npm run test:sql)
│   └── src/
│       ├── server.js          # punto de entrada
│       ├── app.js             # construcción de la app Express
│       ├── config/
│       │   ├── env.js         # única lectura de process.env
│       │   └── db.js          # pool de SQL Server + transacciones + modo ensayo
│       ├── middleware/
│       │   ├── auth.js        # JWT + permitirRoles()
│       │   ├── cuenta.js      # cuenta activa + contraseña temporal, por petición
│       │   ├── limiteIntentos.js  # freno a quien prueba contraseñas al azar
│       │   └── errorHandler.js
│       ├── routes/            # un archivo por módulo
│       ├── controllers/       # validan entrada y responden
│       ├── services/
│       │   ├── solicitudes.service.js   # TODO el SQL de solicitudes vive aquí
│       │   ├── usuarios.service.js      # altas, roles, contraseñas y seguros
│       │   └── erp/
│       │       ├── index.js             # fachada: elige el origen de datos
│       │       ├── quiterClient.js      # API interna de refacciones
│       │       ├── sqlServerClient.js   # SQL Server de Quiter (solo lectura)
│       │       └── catalogoMock.js      # catálogo simulado de respaldo
│       └── utils/
│           ├── estatus.js     # máquina de estados del flujo
│           ├── password.js    # genera la temporal y valida la que elige el usuario
│           └── errors.js
│
├── frontend/
│   ├── vite.config.js         # proxy /api -> localhost:4000
│   ├── public/favicon.svg     # isotipo de CATOSA para la pestaña del navegador
│   └── src/
│       ├── main.jsx  App.jsx  index.css   # tokens de color y modo oscuro
│       ├── api/client.js                  # Axios + JWT + manejo de 401
│       ├── context/AuthContext.jsx        # sesión y rol
│       ├── lib/constantes.js              # estatus, badges y formateadores
│       ├── components/
│       │   ├── Layout.jsx
│       │   ├── LogoCatosa.jsx             # el logo, vectorizado (ver § 4.1)
│       │   ├── BuscadorExistencias.jsx    # consulta al ERP en tiempo real
│       │   ├── FormularioSolicitud.jsx
│       │   ├── PanelSeguimiento.jsx       # modal de cambio de estatus
│       │   ├── DetalleSolicitudModal.jsx  # partidas + bitácora
│       │   └── ui/
│       │       ├── Primitivos.jsx         # botones, campos, badges, modal
│       │       └── Graficos.jsx           # KPIs y barras horizontales
│       └── pages/
│           ├── Login.jsx  VendedorPage.jsx  ComprasPage.jsx  DashboardPage.jsx
│           ├── UsuariosPage.jsx           # administración de cuentas (Gerente)
│           └── CambiarPassword.jsx        # cambio obligatorio y voluntario
│
└── docker-compose.yml         # SQL Server local en Linux/Mac (opcional)
```


### 4.1 El logo

`components/LogoCatosa.jsx` trae el logo de CATOSA **vectorizado**, no como
imagen. Eso importa por tres razones: se ve nítido en cualquier tamaño y en
cualquier pantalla, pesa poco, y —lo principal— toma su color del texto que lo
rodea (`fill="currentColor"`), así que el mismo archivo se ve negro en modo
claro y blanco en modo oscuro sin tener dos versiones.

```jsx
<LogoCatosa className="w-52" />                  // completo, con "CAMIONERA"
<LogoCatosa className="w-24" conBajada={false} /> // solo el círculo y CATOSA
<MarcaCatosa className="w-8" />                   // solo el círculo
```

La bajada "CAMIONERA" se apaga por debajo de unos 140px de ancho, donde ya no
se lee y solo ensucia. Por eso la barra superior la lleva apagada y la pantalla
de entrada encendida.

Si algún día cambia el logo, se vuelve a vectorizar del original y se sustituye
el contenido de ese archivo; ninguna pantalla necesita cambiar.

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
| `usuarios` | Acceso al sistema. `rol` ∈ Vendedor / Comprador / Gerente. `debe_cambiar_password` marca las contraseñas temporales; `creado_por` dice quién dio de alta la cuenta. |
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
- De las contraseñas solo se guarda su huella (bcrypt, 10 rondas). No hay forma
  de recuperar una: se restablece y se genera otra temporal.

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
| `POST` | `/auth/cambiar-password` | todos | Cambio de contraseña propia. Pide la actual. Devuelve un token al día. |
| `GET` | `/productos/existencias?sku=XXX&almacen=101` | todos | **Consulta al ERP.** `sku` acepta código o texto parcial. |
| `POST` | `/solicitudes` | Vendedor, Gerente | Crea encabezado + partidas + primer historial, en **una transacción**. |
| `GET` | `/solicitudes` | todos | Filtros: `id_vendedor`, `prioridad`, `estatus`, `sucursal`, `desde`, `hasta`, `busqueda`, `limite`, `pagina`. |
| `GET` | `/solicitudes/:id` | todos | Encabezado + partidas + bitácora + siguientes estatus posibles. |
| `PATCH` | `/solicitudes/:id/estatus` | Comprador, Gerente | Cambia estatus, fija promesa de entrega y guarda comentario. |
| `GET` | `/dashboard/gerencia?dias=30&sucursal=1` | Comprador, Gerente | KPIs, distribución por estatus, top de faltantes y tiempo de atención. |
| `GET` | `/catalogos/sucursales` · `/catalogos/clientes?q=` | todos | Para los selects del frontend. |
| `GET` | `/usuarios?q=&rol=&activo=` | Gerente | Lista de cuentas. Nunca devuelve el hash de la contraseña. |
| `POST` | `/usuarios` | Gerente | Alta. Devuelve la contraseña temporal **una sola vez**. |
| `PATCH` | `/usuarios/:id` | Gerente | Nombre, rol, sucursal, activo. El correo no se cambia. |
| `POST` | `/usuarios/:id/password` | Gerente | Restablece la contraseña y obliga a cambiarla al entrar. |

Reglas de negocio que impone la API, no solo la interfaz:

- Un **Vendedor** solo ve sus propias solicitudes, aunque mande otro
  `id_vendedor` en la query.
- Un **Vendedor** no puede mover estatus (**403**).
- Pasar a **En Transito** exige `fecha_promesa_entrega` (**400** si falta).
- Solo se aceptan transiciones válidas del flujo (**409** en cualquier otro caso).
- Al llegar a un estatus final se sella `fecha_cierre`, que alimenta el KPI de
  tiempo promedio de atención.
- Mientras alguien traiga contraseña temporal, **toda** la API le responde
  **403** con `codigo: "PASSWORD_TEMPORAL"`, salvo `/auth/yo` y
  `/auth/cambiar-password`.
- Desactivar una cuenta surte efecto en la petición siguiente, no cuando expire
  su token: cada petición protegida revisa el renglón del usuario.
- **Ocho contraseñas equivocadas en 15 minutos bloquean esa cuenta** (**429**)
  el resto de la ventana. Entrar bien borra el contador. Es por cuenta, no por
  dirección IP: detrás del túnel todas las peticiones llegan desde `127.0.0.1`,
  así que limitar por IP dejaría fuera a toda la empresa de un golpe.

---

## 7. Usuarios y accesos

Quién entra al sistema lo decide el **Gerente**, desde la pestaña **Usuarios**.
Ningún otro rol ve esa pantalla, y la API tampoco le responde.

### 7.1 Cómo se da de alta a alguien

1. El Gerente entra a **Usuarios → Nueva cuenta** y captura nombre, correo, rol
   y sucursal.
2. Al guardar, el sistema genera una **contraseña temporal** de 14 caracteres y
   la muestra en pantalla. **Es la única vez que se puede leer**: de ahí en
   adelante solo queda guardada su huella (bcrypt), que no se puede revertir.
3. El Gerente se la entrega a la persona.
4. La primera vez que esa persona entra, el sistema no la deja hacer nada más
   que elegir su propia contraseña. A partir de ahí, nadie —tampoco el
   Gerente— puede verla.

Si alguien la olvida: **Usuarios → Contraseña**. Se genera otra temporal y se
repite el paso 4. No hace falta tocar la base de datos.

### 7.2 Qué puede hacer cada rol

| | Vendedor | Comprador | Gerente |
|---|---|---|---|
| Consultar existencias en Quiter | ✓ | ✓ | ✓ |
| Levantar solicitudes | ✓ | | ✓ |
| Ver solicitudes | solo las suyas | todas | todas |
| Mover estatus | | ✓ | ✓ |
| Dashboard | | ✓ | ✓ |
| Administrar usuarios | | | ✓ |

Un **Vendedor** necesita sucursal: es la que se graba en cada solicitud que
levanta. Compras y Gerencia pueden ir sin ella.

### 7.3 Los seguros que impiden quedarse fuera

Estas reglas las aplica el servidor, no la pantalla:

- Un Gerente **no puede desactivar su propia cuenta** ni **cambiarse el rol**.
  Si pudiera, perdería el acceso a la pantalla que se lo devolvería.
- **No se puede dejar el sistema sin Gerentes activos.** El último no se
  desactiva ni se degrada hasta que haya otro.
- Las cuentas **no se borran, se desactivan**. El nombre de quien capturó una
  solicitud tiene que seguir apareciendo en su bitácora; borrarlo dejaría
  huecos justo en el registro que existe para evitarlos.
- El **correo no se puede cambiar** después del alta: es la identidad con la
  que quedó firmado su historial.

### 7.4 Aplicar el cambio sobre una base que ya tiene datos

La pantalla de usuarios necesita tres columnas nuevas en `dbo.usuarios`. Se
agregan sin tocar nada de lo capturado:

```powershell
cd backend
npm run db:migrar
```

Ese comando aplica `database/03_migracion_usuarios.sql`, que revisa qué falta
antes de agregar cada cosa: **se puede correr las veces que haga falta** y no
borra ni modifica ningún renglón existente.

> `npm run db:setup` es lo contrario: instala de cero y **empieza tirando las
> tablas**. En el servidor, una vez que haya solicitudes capturadas, el comando
> es `db:migrar`. Nunca `db:setup`.

### 7.5 Antes de abrir el sistema al equipo

Las cuatro cuentas `@demo.mx` que carga el seed comparten una contraseña que
está escrita en este README. Sirven para probar; en el servidor son una puerta
abierta.

1. Crea primero tu propia cuenta de Gerente, con tu correo real.
2. Entra con ella y cambia la contraseña temporal.
3. Crea las cuentas de Compras y las de los vendedores.
4. Entra a **Usuarios**, marca *Incluir desactivadas* para verlas todas y
   **desactiva las cuatro cuentas `@demo.mx`**.

Mientras alguna siga activa, la pantalla de Usuarios muestra un aviso amarillo
y el servidor lo advierte en su bitácora al arrancar con `NODE_ENV=production`.

---

## 8. De dónde salen las existencias

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

### 8.1 Usuario de solo lectura (para el camino 1)

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

### 8.2 De dónde sale cada dato

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

### 8.3 Dos errores a NO repetir

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

## 9. Pendientes para producción

- [ ] Cambiar `JWT_SECRET` por una cadena larga y aleatoria (§ 10.7).
- [ ] Crear las cuentas reales y **desactivar las cuatro `@demo.mx`** (§ 7.5).
- [ ] Crear la base `SGC_COMPRAS` en el servidor y apuntar el `.env` ahí.
- [ ] Notificación al vendedor cuando su solicitud cambia de estatus.
- [ ] Exportar a Excel la Mesa de Trabajo y el top de faltantes.
- [ ] Adjuntar cotizaciones del proveedor a la solicitud.
- [ ] HTTPS y `CORS_ORIGIN` apuntando solo al dominio real.
- [ ] Evaluar Cloudflare Zero Trust delante del dominio (§ 10.7).

---

## 10. Despliegue en el servidor

El sistema se publica igual que `catosa-api`: **corriendo en el servidor Windows
de la empresa y expuesto por el mismo túnel de Cloudflare**. No va en Railway ni
en un servicio en la nube, porque Quiter vive en la red interna y desde afuera
no hay cómo alcanzarlo.

La diferencia con las demás apps: aquéllas son HTML sueltos que GitHub Pages
sirve tal cual, y ésta es React, que hay que compilar. Por eso **el mismo Node
sirve la API y la interfaz**: un solo despliegue, un solo dominio, sin CORS.

### 10.1 La forma corta: un solo comando

`scripts/desplegar-servidor.ps1` hace de corrido todo lo que se puede
automatizar. Va **en el servidor**, no en la computadora de nadie: en una
laptop solo dejaría una segunda instalación que no le sirve a nadie.

En el servidor, con PowerShell **como Administrador**:

```powershell
# 1. Traer el código (solo la primera vez)
git clone https://github.com/AMHER-MX/sistema-solicitudes-compras.git C:\apps\sgc-compras
cd C:\apps\sgc-compras

# 2. Primero mirar, sin tocar nada
powershell -ExecutionPolicy Bypass -File .\scripts\desplegar-servidor.ps1 -SoloRevisar

# 3. Y ya con el diagnóstico a la vista
powershell -ExecutionPolicy Bypass -File .\scripts\desplegar-servidor.ps1
```

> **Por qué `-ExecutionPolicy Bypass`.** Windows Server viene de fábrica
> negándose a ejecutar archivos `.ps1`; el error dice *"no se puede cargar
> porque la ejecución de scripts está deshabilitada en este sistema"*. Ese
> parámetro levanta la restricción **solo para esa corrida**, sin cambiar la
> configuración del servidor — que es justo lo que se quiere: no dejar la
> puerta abierta para después.

De la primera vez en adelante ya no hace falta clonar: el script mismo
actualiza el código con `git pull`.

Qué hace, en orden: revisa Node y Git · clona o actualiza el código · prepara
el `.env` (pide solo lo que no puede adivinar y **genera la llave JWT él mismo**,
sin que nadie la vea ni la teclee) · instala dependencias con `npm ci` ·
**diagnostica la base y decide**: instala el esquema si está vacía o solo migra
si ya tiene datos · corre las pruebas · compila la interfaz · arranca la
aplicación un momento y comprueba `/api/health` · registra la tarea de Windows
para que sobreviva a un reinicio.

Lo importante de ese punto medio: la decisión de la base **no la toma quien
corre el script**, la toma `npm run db:estado` mirando lo que hay. `db:setup`
empieza tirando las tablas, y correrlo por error sobre una base en uso borraría
todas las solicitudes capturadas. El script nunca lo corre sobre una base con
datos.

Se puede correr las veces que haga falta: en una instalación ya montada,
actualiza el código y la base sin tocar el `.env`.

Lo que **no** hace, porque es configuración de red y a ciegas sería peligroso:
la entrada en `cloudflared` y el registro DNS (§ 10.3). Al terminar imprime
exactamente qué falta, con las líneas listas para copiar.

### 10.2 Preparar la aplicación a mano

```powershell
cd backend
npm install
npm run build:interfaz     # compila el frontend a frontend/dist
npm start
```

Al arrancar, la consola dice si encontró la interfaz compilada. Si la ve, todo
—pantallas y datos— sale por el mismo puerto.

### 10.3 Publicarla por el túnel de Cloudflare

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

### 10.4 Que siga corriendo al reiniciar

Node no se queda como servicio por sí solo. Usa **el mismo mecanismo con el que
ya se mantiene `catosa-api`** — lo importante es que sea uno solo para las dos,
para no tener que acordarse de dos formas distintas. Las opciones habituales son
NSSM (`nssm install SGC-Compras`), una tarea programada al inicio del sistema
con *"Ejecutar aunque el usuario no haya iniciado sesión"*, o PM2.

### 10.5 El `.env` de producción

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


### 10.6 Antes de crear el registro DNS

El momento en que existe `compras.catosaapps.lat` es el momento en que el
formulario de entrada queda expuesto a internet. Estas cuatro cosas van
**antes**, no después:

**1. Una llave JWT propia del servidor.** La de pruebas es un valor por omisión
que está escrito en el código: quien lo lea puede fabricarse un token de
Gerente. Este comando genera una nueva y la escribe en el `.env` sin que nadie
tenga que verla ni teclearla:

```powershell
cd backend
$llave = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
Add-Content .env "JWT_SECRET=`"$llave`""
Remove-Variable llave
```

Si ya había una línea `JWT_SECRET` en el `.env`, borra la vieja: dotenv se
queda con la primera. Cambiar la llave cierra todas las sesiones abiertas
—eso es justo lo que se busca.

**2. `NODE_ENV=production` y `CORS_ORIGIN=https://compras.catosaapps.lat`.**
Con `NODE_ENV` en producción, los errores dejan de incluir el detalle técnico
en la respuesta y el servidor avisa en su bitácora si quedaron cuentas de
prueba vivas.

**3. Las cuentas reales creadas y las cuatro `@demo.mx` desactivadas** (§ 7.5).
Mientras `gerente@demo.mx` siga activa, la contraseña de esa cuenta está
escrita en este README.

**4. Comprobar que responde antes de publicarlo.** Con el servicio corriendo:

```powershell
curl http://localhost:4000/api/health
```

Debe contestar `"conectada": true` y decir que el ERP está en `SQLSERVER`.

### 10.7 Una reja más, si la quieres

Cloudflare Zero Trust permite poner una puerta de identidad **delante** del
sistema: quien no traiga un correo de la empresa no llega ni a ver la pantalla
de entrada. Es una configuración en el panel de Cloudflare, del lado del túnel
que ya tienen, y no requiere tocar el código.

No es obligatorio —el sistema ya pide usuario y contraseña, y ya frena a quien
las prueba al azar—, pero para una herramienta interna que no necesita ser
alcanzable desde cualquier parte del mundo, es la diferencia entre "protegido
por una contraseña" y "ni siquiera visible".

---

## 11. Subir cambios a GitHub

El repositorio es **https://github.com/AMHER-MX/sistema-solicitudes-compras** (privado).

```powershell
git add -A
git commit -m "describe aquí el cambio"
git push
```

`.gitignore` ya excluye `node_modules/`, los archivos `.env` y los builds, así
que **no se suben credenciales**. Los `.env.example` sí se suben: son la
plantilla para que cada persona arme su propio `.env`.
